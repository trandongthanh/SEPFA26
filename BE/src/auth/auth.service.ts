import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { EntityManager, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import type { SelfRegisterRole } from '../common/constants/roles';
import {
  mapIdentityUniqueViolation,
  normalizePhone,
  sha256Hex,
} from '../common/identity';
import { PasswordService } from '../crypto/password.service';
import {
  MailService,
  PASSWORD_RESET_LINK_MINUTES,
  REGISTER_OTP_MINUTES,
  RESET_PASSWORD_OTP_MINUTES,
} from '../mail/mail.service';
import { EmailOtp, type EmailOtpPurpose } from './entities/email-otp.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import { TokenService, type JwtPayload } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  ResetPasswordWithOtpDto,
  SendEmailOtpDto,
  SendRegisterOtpDto,
  VerifyOtpDto,
} from './dto/otp.dto';
import type { CurrentUserData } from './types/current-user.type';
import {
  ActiveSessionDto,
  AuthTokensResponseDto,
  ForgotPasswordResponseDto,
  GoogleAuthResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
  RevokeSessionResponseDto,
  SendOtpResponseDto,
  VerifyEmailResponseDto,
  VerifyRegisterOtpResponseDto,
  VerifyResetOtpResponseDto,
} from './dto/auth-response.dto';

import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { EkycRecord } from '../ekyc/entities/ekyc-record.entity';
import { EkycService } from '../ekyc/ekyc.service';
import { CryptoService } from '../crypto/crypto.service';
import { RegisterWithEkycDto } from './dto/register-with-ekyc.dto';

// Postgres unique_violation — 2 request đăng ký cùng email chạy song song.
const PG_UNIQUE_VIOLATION = '23505';

const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_LINK_MINUTES * 60 * 1000;
const OTP_COOLDOWN_SECONDS = 60;
const OTP_MAX_ATTEMPTS = 5;
const REGISTER_OTP_TTL_MS = REGISTER_OTP_MINUTES * 60 * 1000;
const RESET_PASSWORD_OTP_TTL_MS = RESET_PASSWORD_OTP_MINUTES * 60 * 1000;
const RESET_TOKEN_AFTER_OTP_TTL_MS = 15 * 60 * 1000;

/**
 * Nghiệp vụ xác thực: đăng ký, đăng nhập (email/mật khẩu và Google), làm mới phiên, đăng xuất.
 *
 * Quy ước chung (đọc trước khi sửa):
 * - ACCOUNT là tài khoản "base": đăng ký thông thường tạo 1 dòng accounts (status PENDING).
 * - ĐĂNG KÝ KÈM eKYC (registerWithEkyc): tự động tạo account ACTIVE + CustomerProfile APPROVED
 *   ngay sau khi xác thực CCCD và khuôn mặt thành công, không cần Admin duyệt tay.
 * - Luật "ai được đăng nhập" nằm DUY NHẤT ở AccountsService.isAllowedToAuthenticate
 *   (dùng chung cho login, Google, refresh và JWT guard) — đổi luật thì sửa ở đó.
 * - Phiên = refresh token, lưu ở bảng refresh_tokens dưới dạng SHA-256 (không lưu token thô).
 *   Access token KHÔNG lưu DB: tự hết hạn (JWT_ACCESS_EXPIRES), guard tra account mỗi request.
 * - Tài khoản tạo bằng Google vẫn có mật khẩu (tự sinh, gửi qua mail) → đăng nhập được cả 2 cách;
 *   không có bảng liên kết Google riêng, tài khoản được nhận diện theo EMAIL.
 * - Quên mật khẩu: token 1 lần (lưu SHA-256, hạn 30 phút) gửi qua mail; đặt lại xong thu hồi
 *   MỌI phiên — giống đổi mật khẩu.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    @InjectRepository(CustomerProfile)
    private readonly customerProfiles: Repository<CustomerProfile>,
    @InjectRepository(EkycRecord)
    private readonly ekycRecords: Repository<EkycRecord>,
    @InjectRepository(PasswordResetToken)
    private readonly passwordResetTokens: Repository<PasswordResetToken>,
    @InjectRepository(EmailOtp)
    private readonly emailOtps: Repository<EmailOtp>,
    private readonly accountsService: AccountsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly mail: MailService,
    private readonly ekycService: EkycService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * POST /auth/register/send-otp — gửi mã OTP 6 chữ số tới email chưa đăng ký.
   * Email đã tồn tại → 409 EMAIL_EXISTS; gửi lại trong vòng 60s → 429 OTP_COOLDOWN.
   */
  async sendRegisterOtp(dto: SendRegisterOtpDto): Promise<SendOtpResponseDto> {
    if (await this.accounts.exists({ where: { email: dto.email } })) {
      throw new ConflictException('EMAIL_EXISTS');
    }
    const otp = await this.issueEmailOtp(
      dto.email,
      'REGISTER',
      REGISTER_OTP_TTL_MS,
    );
    await this.mail.sendRegistrationOtp({
      to: dto.email,
      fullName: dto.fullName,
      otp,
      expiresMinutes: REGISTER_OTP_MINUTES,
    });
    return {
      success: true,
      expiresInSeconds: REGISTER_OTP_MINUTES * 60,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    };
  }

  /**
   * POST /auth/register/verify-otp — kiểm tra & tiêu thụ OTP đăng ký, trả verificationToken
   * (JWT sống 15 phút) để FE/Mobile gửi lên bước POST /auth/register hoặc /auth/register-with-ekyc.
   */
  async verifyRegisterOtp(
    dto: VerifyOtpDto,
  ): Promise<VerifyRegisterOtpResponseDto> {
    await this.verifyAndConsumeOtp(dto.email, 'REGISTER', dto.otp);
    return {
      verified: true,
      verificationToken: this.tokens.signEmailVerification(dto.email),
    };
  }

  /**
   * POST /auth/register — tạo ACCOUNT base (status PENDING), KHÔNG tạo hồ sơ
   * customer/provider (thuộc bước kích hoạt). Hỗ trợ:
   * - verificationToken (2 bước sau /auth/register/verify-otp) → emailVerifiedAt = now
   * - otp (1 bước kèm OTP trực tiếp) → emailVerifiedAt = now
   * - không gửi cả hai → emailVerifiedAt = null (tương thích ngược).
   */
  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    if (await this.accounts.exists({ where: { email: dto.email } })) {
      throw new ConflictException('EMAIL_EXISTS');
    }

    let emailVerifiedAt: Date | null = null;
    if (dto.verificationToken) {
      emailVerifiedAt = this.verifyEmailVerificationToken(
        dto.email,
        dto.verificationToken,
      );
    } else if (dto.otp) {
      await this.checkOtpRecord(
        this.emailOtps,
        dto.email,
        'REGISTER',
        dto.otp,
      );
      emailVerifiedAt = new Date();
    }

    // Băm (~300ms) trước khi ghi — không giữ connection DB trong lúc băm.
    const passwordHash = await this.passwords.hash(dto.password);

    const account =
      !dto.verificationToken && dto.otp
        ? await this.accounts.manager.transaction(async (manager) => {
            await this.verifyAndConsumeOtp(
              dto.email,
              'REGISTER',
              dto.otp!,
              manager,
            );
            return this.createAccount(
              {
                email: dto.email,
                passwordHash,
                fullName: dto.fullName,
                role: dto.role,
                emailVerifiedAt,
              },
              manager,
            );
          })
        : await this.createAccount({
            email: dto.email,
            passwordHash,
            fullName: dto.fullName,
            role: dto.role,
            emailVerifiedAt,
          });

    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
    };
  }

  /**
   * POST /auth/register-with-ekyc — Đăng ký tài khoản kèm eKYC tức thời trong RAM (Zero-Retention):
   * - Check trùng Email & SĐT và xác thực OTP/verificationToken (nếu có) trước khi gọi AI
   * - AI OCR bóc tách họ tên, ngày sinh, quê quán, địa chỉ thường trú (KHÔNG thu giữ số CCCD)
   * - AI Anti-Fraud & Liveness & Face Match trong RAM — KHÔNG lưu trữ ảnh lên DB hay Cloud
   * - Ghi Account + CustomerProfile + EkycRecord trong 1 transaction
   * - Cấp tokens và trả kết quả để đăng nhập ngay lập tức.
   */
  async registerWithEkyc(
    dto: RegisterWithEkycDto,
    files: {
      cccdFront: Express.Multer.File;
      selfie: Express.Multer.File;
    },
    userAgent?: string,
  ) {
    if (await this.accounts.exists({ where: { email: dto.email } })) {
      throw new ConflictException('EMAIL_EXISTS');
    }

    let emailVerifiedAt: Date | null = null;
    if (dto.verificationToken) {
      emailVerifiedAt = this.verifyEmailVerificationToken(
        dto.email,
        dto.verificationToken,
      );
    } else if (dto.otp) {
      await this.checkOtpRecord(
        this.emailOtps,
        dto.email,
        'REGISTER',
        dto.otp,
      );
      emailVerifiedAt = new Date();
    }

    // Kiểm tra trùng SĐT trước khi gọi AI để tránh tốn tài nguyên nếu đã trùng
    let phoneEnc: string | null = null;
    let phoneHash: string | null = null;
    if (dto.phone?.trim()) {
      const cleanPhone = normalizePhone(dto.phone);
      phoneHash = sha256Hex(cleanPhone);
      const dupPhone = await this.accounts.findOne({ where: { phoneHash } });
      if (dupPhone) {
        throw new ConflictException(
          'Số điện thoại này đã được sử dụng bởi một tài khoản khác.',
        );
      }
      phoneEnc = this.crypto.encrypt(cleanPhone);
    }

    // Chạy quy trình eKYC trong RAM: OCR + Anti-Fraud + Liveness + Face Match (không lưu ảnh & số CCCD)
    const ekycData = await this.ekycService.verifyAndProcessRegistrationEkyc(
      files.cccdFront,
      files.selfie,
    );

    // Băm mật khẩu ngoài transaction
    const passwordHash = await this.passwords.hash(dto.password);

    // Ưu tiên tên người dùng nhập, nếu không có thì lấy tên chính xác do AI đọc
    const fullName = dto.fullName?.trim() || ekycData.fullName || 'Khách hàng';

    const { account, tokens } = await this.accounts.manager.transaction(
      async (manager) => {
        if (!dto.verificationToken && dto.otp) {
          await this.verifyAndConsumeOtp(
            dto.email,
            'REGISTER',
            dto.otp,
            manager,
          );
        }

        let createdAccount: Account;
        try {
          createdAccount = await manager.save(
            manager.create(Account, {
              email: dto.email,
              passwordHash,
              fullName,
              role: dto.role,
              phone: phoneEnc,
              phoneHash,
              status: 'ACTIVE',
              emailVerifiedAt,
            }),
          );
        } catch (err) {
          const mapped = mapIdentityUniqueViolation(err);
          if (mapped !== err) {
            throw mapped;
          }
          if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
            throw new ConflictException('EMAIL_EXISTS');
          }
          throw err;
        }

        if (createdAccount.role === 'CUSTOMER') {
          await manager.save(
            manager.create(CustomerProfile, {
              accountId: createdAccount.id,
              verificationStatus: 'APPROVED',
              verificationNote:
                'eKYC tự động xác thực tức thời khi đăng ký (không lưu ảnh & số CCCD)',
              address: ekycData.placeOfResidence ?? null,
              dateOfBirth: ekycData.dateOfBirth,
              placeOfOrigin: ekycData.placeOfOrigin,
            }),
          );
        }

        await manager.save(
          manager.create(EkycRecord, {
            accountId: createdAccount.id,
            status: 'VERIFIED',
            idDocType: ekycData.idDocType,
            fullNameExtracted: ekycData.fullName,
            dateOfBirth: ekycData.dateOfBirth,
            gender: ekycData.gender,
            nationality: ekycData.nationality,
            placeOfOrigin: ekycData.placeOfOrigin,
            placeOfResidence: ekycData.placeOfResidence,
            faceMatch: true,
            faceSimilarity: ekycData.similarity.toFixed(2),
            fraudScore: ekycData.fraudScore?.toFixed(2) ?? null,
            livenessScore: ekycData.livenessScore?.toFixed(2) ?? null,
            antifraudDetails: ekycData.antifraudDetails as any,
            verifiedAt: new Date(),
          }),
        );

        const issuedTokens = await this.issueTokens(
          createdAccount,
          userAgent,
          manager,
        );
        return { account: createdAccount, tokens: issuedTokens };
      },
    );

    return {
      success: true,
      message:
        'Đăng ký và xác thực eKYC thành công! Tài khoản đã được tự động kích hoạt (không lưu ảnh & số CCCD).',
      account: {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        status: account.status,
      },
      ekyc: {
        status: 'VERIFIED',
        fullName: ekycData.fullName,
        dateOfBirth: ekycData.dateOfBirth,
        placeOfOrigin: ekycData.placeOfOrigin,
        placeOfResidence: ekycData.placeOfResidence,
        similarity: Number(ekycData.similarity.toFixed(2)),
      },
      tokens,
    };
  }

  /**
   * POST /auth/verify-email/send-otp — gửi OTP xác thực email cho tài khoản đã đăng ký
   * nhưng chưa xác thực email. Luôn trả { success: true, ... } nếu email không tồn tại / đã
   * xác thực / bị khoá (chống dò email).
   */
  async sendEmailVerificationOtp(
    dto: SendEmailOtpDto,
  ): Promise<SendOtpResponseDto> {
    const baseResponse: SendOtpResponseDto = {
      success: true,
      expiresInSeconds: REGISTER_OTP_MINUTES * 60,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    };
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (
      !account ||
      !this.accountsService.isAllowedToAuthenticate(account) ||
      account.emailVerifiedAt !== null
    ) {
      return baseResponse;
    }

    const otp = await this.issueEmailOtp(
      account.email,
      'VERIFY_EMAIL',
      REGISTER_OTP_TTL_MS,
    );
    await this.mail.sendEmailVerificationOtp({
      to: account.email,
      fullName: account.fullName,
      otp,
      expiresMinutes: REGISTER_OTP_MINUTES,
    });
    return baseResponse;
  }

  /**
   * POST /auth/verify-email — xác thực OTP để đánh dấu accounts.email_verified_at.
   */
  async verifyEmail(dto: VerifyOtpDto): Promise<VerifyEmailResponseDto> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      throw new BadRequestException('OTP_INVALID');
    }

    await this.accounts.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Account, {
        where: { id: account.id },
        lock: { mode: 'for_no_key_update' },
      });
      if (!this.accountsService.isAllowedToAuthenticate(locked)) {
        throw new BadRequestException('OTP_INVALID');
      }
      await this.verifyAndConsumeOtp(
        dto.email,
        'VERIFY_EMAIL',
        dto.otp,
        manager,
      );
      if (!locked!.emailVerifiedAt) {
        await manager.update(
          Account,
          { id: account.id },
          { emailVerifiedAt: new Date() },
        );
      }
    });

    return { success: true, emailVerified: true };
  }

  /**
   * POST /auth/login — email + mật khẩu (kể cả mật khẩu tự sinh gửi qua mail cho tài khoản Google).
   * Sai email HOẶC sai mật khẩu → cùng 401 INVALID_CREDENTIALS (chống dò email).
   */
  async login(
    dto: LoginDto,
    userAgent?: string,
  ): Promise<AuthTokensResponseDto> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    // LUÔN chạy bcrypt (email sai thì so với hash mồi) — thời gian phản hồi đồng đều.
    const passwordOk = await this.passwords.compare(
      dto.password,
      account?.passwordHash ?? this.passwords.dummyHash,
    );
    if (!account || !passwordOk) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    this.assertCanAuthenticate(account);
    return this.issueTokens(account, userAgent);
  }

  /**
   * POST /auth/google — đăng nhập / đăng ký bằng Google ID token.
   * - Email Google đã có tài khoản (tạo bằng Google hay đăng ký thường) → đăng nhập; role gửi kèm bị bỏ qua.
   * - Chưa có + thiếu role → 404 GOOGLE_ACCOUNT_NOT_REGISTERED kèm email/tên: FE hỏi loại tài khoản
   *   rồi gọi lại với CÙNG idToken (ID token Google sống ~1 giờ).
   * - Chưa có + có role → tạo account base với mật khẩu ngẫu nhiên, gửi mật khẩu qua mail
   *   để sau này đăng nhập được cả bằng email + mật khẩu. isNewAccount=true cho FE báo "kiểm tra mail".
   *
   * Rủi ro đã chấp nhận: đăng ký thường không xác thực email, nên người đăng ký TRƯỚC bằng email của
   * người khác sẽ sở hữu tài khoản mà chủ email vào được bằng Google (pre-account hijacking).
   * Cách khắc phục khi cần: xác thực email ở /auth/register.
   */
  async loginWithGoogle(
    dto: GoogleLoginDto,
    userAgent?: string,
  ): Promise<GoogleAuthResponseDto> {
    const profile = await this.google.verify(dto.idToken);

    const existing = await this.accounts.findOne({
      where: { email: profile.email },
    });
    if (existing) {
      return this.loginExistingWithGoogle(existing, userAgent);
    }

    if (!dto.role) {
      throw new NotFoundException({
        message: 'GOOGLE_ACCOUNT_NOT_REGISTERED',
        email: profile.email,
        fullName: profile.fullName,
      });
    }

    const password = generatePassword();
    let account: Account;
    try {
      account = await this.createAccount({
        email: profile.email,
        passwordHash: await this.passwords.hash(password),
        fullName: profile.fullName,
        role: dto.role,
        emailVerifiedAt: new Date(),
      });
    } catch (err) {
      // Bấm nút Google 2 lần: request kia vừa tạo xong account → đăng nhập vào account đó.
      if (!(err instanceof ConflictException)) {
        throw err;
      }
      const created = await this.accounts.findOneOrFail({
        where: { email: profile.email },
      });
      return this.loginExistingWithGoogle(created, userAgent);
    }
    // Mail là phụ: gửi lỗi vẫn đăng nhập được bằng Google (MailService tự log lỗi).
    await this.mail.sendGooglePassword({
      to: account.email,
      fullName: account.fullName,
      password,
    });
    const tokens = await this.issueTokens(account, userAgent);
    return { ...tokens, isNewAccount: true };
  }

  /**
   * POST /auth/refresh — rotation: mỗi refresh token dùng đúng 1 lần, dùng xong nhận cặp mới.
   * Token đã bị thu hồi (đã xoay, đã logout, hoặc bị thu hồi khi đổi mật khẩu) mà vẫn được gửi lại
   * → coi như token bị lộ: thu hồi MỌI phiên của account (mọi thiết bị phải đăng nhập lại).
   * Không có khái niệm "family" theo thiết bị (bảng refresh_tokens không có cột đó) nên không thể
   * chỉ thu hồi riêng 1 thiết bị — đánh đổi có chủ đích để giữ schema đơn giản.
   */
  async refresh(
    dto: RefreshTokenDto,
    userAgent?: string,
  ): Promise<AuthTokensResponseDto> {
    let payload: JwtPayload;
    try {
      payload = this.tokens.verifyRefresh(dto.refreshToken);
    } catch {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    const tokenHash = this.tokens.hashToken(dto.refreshToken);
    const record = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (!record || record.accountId !== payload.sub) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }
    if (record.revokedAt) {
      await this.revokeAllSessions(record.accountId);
      throw new UnauthorizedException('REFRESH_TOKEN_REUSED');
    }

    const account = await this.accountsService.findAuthenticatableById(
      record.accountId,
    );
    if (!account) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // Thu hồi token cũ + cấp token mới trong 1 transaction. Thu hồi có điều kiện
    // (revoked_at IS NULL) → 2 request song song cùng 1 token chỉ 1 cái thắng.
    const result = await this.refreshTokens.manager.transaction(
      async (manager) => {
        const revoke = await manager.update(
          RefreshToken,
          { id: record.id, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
        if (revoke.affected !== 1) {
          return null;
        }
        return this.issueTokens(account, userAgent, manager);
      },
    );
    if (!result) {
      // Thua cuộc đua = token đã bị dùng. Thu hồi NGOÀI transaction — ném lỗi
      // trong transaction sẽ rollback luôn lệnh thu hồi.
      await this.revokeAllSessions(record.accountId);
      throw new UnauthorizedException('REFRESH_TOKEN_REUSED');
    }
    return result;
  }

  /**
   * POST /auth/logout — có refreshToken thì thu hồi đúng token đó (của chính account),
   * bỏ trống thì thu hồi mọi phiên. Idempotent.
   */
  async logout(
    user: CurrentUserData,
    dto: LogoutDto,
  ): Promise<LogoutResponseDto> {
    if (dto.refreshToken) {
      await this.refreshTokens.update(
        {
          accountId: user.accountId,
          tokenHash: this.tokens.hashToken(dto.refreshToken),
          revokedAt: IsNull(),
        },
        { revokedAt: new Date() },
      );
    } else {
      await this.revokeAllSessions(user.accountId);
    }
    return { success: true };
  }

  /**
   * POST /auth/forgot-password — LUÔN trả { success: true } (email có tồn tại hay không như nhau,
   * chống dò email). Account tồn tại + được đăng nhập (không SUSPENDED) → xoá token cũ của
   * account (chỉ link mới nhất dùng được), tạo token mới, gửi mail chứa link.
   *
   * Rủi ro đã chấp nhận: email có account phải ghi DB + gửi SMTP nên phản hồi chậm hơn email lạ
   * → dò email qua thời gian vẫn khả thi. Không gửi mail nền được vì Vercel huỷ tác vụ nền sau
   * khi trả response (xem MailService). Rate limit theo IP 10/phút làm việc dò chậm lại (lớp
   * theo IP+email 3/phút KHÔNG giúp ở đây — mỗi lần dò là 1 email khác).
   */
  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      return { success: true };
    }

    const token = randomBytes(32).toString('base64url');
    const issued = await this.refreshTokens.manager.transaction(
      async (manager) => {
        // Khoá dòng account: 2 yêu cầu song song chạy LẦN LƯỢT (xoá cũ → tạo mới) → chỉ còn
        // đúng 1 token (của yêu cầu sau). Không khoá thì cả 2 cùng thấy "chưa có token" và
        // cùng tạo → 2 link cùng dùng được.
        // THỨ TỰ KHOÁ chung của auth: account TRƯỚC, bảng token SAU (giống reset + đổi mật
        // khẩu) — ngược thứ tự thì 2 transaction chờ nhau vòng tròn → deadlock → 500.
        // FOR NO KEY UPDATE: vẫn tuần tự hoá các lệnh khoá account, nhưng không chặn insert
        // refresh token (login/refresh chỉ cần KEY SHARE qua FK).
        const locked = await manager.findOne(Account, {
          where: { id: account.id },
          lock: { mode: 'for_no_key_update' },
        });
        if (!this.accountsService.isAllowedToAuthenticate(locked)) {
          return false;
        }
        await manager.delete(PasswordResetToken, { accountId: account.id });
        await manager.save(
          manager.create(PasswordResetToken, {
            accountId: account.id,
            tokenHash: this.tokens.hashToken(token),
            expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
          }),
        );
        return true;
      },
    );
    if (!issued) {
      return { success: true };
    }
    // Mail là phụ: gửi lỗi vẫn trả success (MailService tự log) — người dùng bấm gửi lại.
    await this.mail.sendPasswordReset({
      to: account.email,
      fullName: account.fullName,
      token,
    });
    return { success: true };
  }

  /**
   * POST /auth/reset-password — đổi mật khẩu bằng token trong mail, thu hồi MỌI phiên.
   * Token sai / hết hạn / đã dùng / account bị khoá → cùng 1 mã 400 RESET_TOKEN_INVALID.
   * "Đốt" token có điều kiện (used_at IS NULL AND expires_at > now) → 2 request song song
   * cùng token chỉ 1 cái đổi được mật khẩu.
   */
  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = this.tokens.hashToken(dto.token);
    // Tra token TRƯỚC (rẻ) — token rác/đã dùng/hết hạn trả 400 ngay, không tốn bcrypt ~300ms.
    // Đây chỉ là lọc sớm: chốt chống chạy song song vẫn là UPDATE có điều kiện bên dưới.
    const record = await this.passwordResetTokens.findOne({
      where: { tokenHash, usedAt: IsNull(), expiresAt: MoreThan(new Date()) },
    });
    if (!record) {
      throw new BadRequestException('RESET_TOKEN_INVALID');
    }
    // Băm ngoài transaction — không giữ connection DB trong lúc băm.
    const passwordHash = await this.passwords.hash(dto.newPassword);

    const done = await this.refreshTokens.manager.transaction(
      async (manager) => {
        // Khoá account TRƯỚC khi đốt token — cùng thứ tự với forgot + đổi mật khẩu
        // (account → token). Trước đây đốt token trước rồi mới đụng account: chạy cùng lúc
        // với forgot/đổi mật khẩu thì 2 bên chờ nhau → deadlock (40P01) → 500.
        const account = await manager.findOne(Account, {
          where: { id: record.accountId },
          lock: { mode: 'for_no_key_update' },
        });
        const now = new Date();
        const consumed = await manager.update(
          PasswordResetToken,
          { id: record.id, usedAt: IsNull(), expiresAt: MoreThan(now) },
          { usedAt: now },
        );
        if (consumed.affected !== 1) {
          return false;
        }
        // Account bị khoá: token vẫn bị đốt (transaction commit), không đổi mật khẩu.
        if (!this.accountsService.isAllowedToAuthenticate(account)) {
          return false;
        }
        await manager.update(
          Account,
          { id: record.accountId },
          { passwordHash },
        );
        await this.revokeAllSessions(record.accountId, manager);
        await manager.delete(EmailOtp, {
          email: account!.email,
          purpose: 'RESET_PASSWORD',
        });
        return true;
      },
    );
    if (!done) {
      throw new BadRequestException('RESET_TOKEN_INVALID');
    }
  }

  /**
   * POST /auth/forgot-password/otp — gửi mã OTP 6 chữ số đặt lại mật khẩu.
   * LUÔN trả { success: true, ... } kể cả email không tồn tại (chống dò email).
   */
  async forgotPasswordOtp(dto: ForgotPasswordDto): Promise<SendOtpResponseDto> {
    const baseResponse: SendOtpResponseDto = {
      success: true,
      expiresInSeconds: RESET_PASSWORD_OTP_MINUTES * 60,
      cooldownSeconds: OTP_COOLDOWN_SECONDS,
    };
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      return baseResponse;
    }

    const otp = await this.refreshTokens.manager.transaction(
      async (manager) => {
        const locked = await manager.findOne(Account, {
          where: { id: account.id },
          lock: { mode: 'for_no_key_update' },
        });
        if (!this.accountsService.isAllowedToAuthenticate(locked)) {
          return null;
        }
        return this.issueEmailOtp(
          account.email,
          'RESET_PASSWORD',
          RESET_PASSWORD_OTP_TTL_MS,
          manager,
        );
      },
    );
    if (!otp) {
      return baseResponse;
    }

    await this.mail.sendPasswordResetOtp({
      to: account.email,
      fullName: account.fullName,
      otp,
      expiresMinutes: RESET_PASSWORD_OTP_MINUTES,
    });
    return baseResponse;
  }

  /**
   * POST /auth/forgot-password/verify-otp — luồng 2 bước: xác thực OTP quên mật khẩu
   * và cấp resetToken một lần (15 phút) để gọi tiếp POST /auth/reset-password.
   */
  async verifyForgotPasswordOtp(
    dto: VerifyOtpDto,
  ): Promise<VerifyResetOtpResponseDto> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      throw new BadRequestException('OTP_INVALID');
    }

    const resetToken = randomBytes(32).toString('base64url');
    await this.refreshTokens.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Account, {
        where: { id: account.id },
        lock: { mode: 'for_no_key_update' },
      });
      if (!this.accountsService.isAllowedToAuthenticate(locked)) {
        throw new BadRequestException('OTP_INVALID');
      }
      await this.verifyAndConsumeOtp(
        dto.email,
        'RESET_PASSWORD',
        dto.otp,
        manager,
      );
      await manager.delete(PasswordResetToken, { accountId: account.id });
      await manager.save(
        manager.create(PasswordResetToken, {
          accountId: account.id,
          tokenHash: this.tokens.hashToken(resetToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_AFTER_OTP_TTL_MS),
        }),
      );
    });

    return {
      verified: true,
      resetToken,
      expiresInSeconds: RESET_TOKEN_AFTER_OTP_TTL_MS / 1000,
    };
  }

  /**
   * POST /auth/reset-password-otp — luồng 1 bước: gửi email + OTP + newPassword để đặt lại mật khẩu ngay.
   * Thu hồi mọi phiên đăng nhập và xoá toàn bộ PasswordResetToken đang chờ.
   */
  async resetPasswordWithOtp(dto: ResetPasswordWithOtpDto): Promise<void> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      throw new BadRequestException('OTP_INVALID');
    }

    await this.checkOtpRecord(
      this.emailOtps,
      dto.email,
      'RESET_PASSWORD',
      dto.otp,
    );

    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.refreshTokens.manager.transaction(async (manager) => {
      const locked = await manager.findOne(Account, {
        where: { id: account.id },
        lock: { mode: 'for_no_key_update' },
      });
      if (!this.accountsService.isAllowedToAuthenticate(locked)) {
        throw new BadRequestException('OTP_INVALID');
      }
      await this.verifyAndConsumeOtp(
        dto.email,
        'RESET_PASSWORD',
        dto.otp,
        manager,
      );
      await manager.update(Account, { id: account.id }, { passwordHash });
      await this.revokeAllSessions(account.id, manager);
      await manager.delete(PasswordResetToken, { accountId: account.id });
    });
  }

  /**
   * GET /auth/sessions — liệt kê các phiên đăng nhập đang còn hiệu lực (không trả tokenHash).
   */
  async listSessions(user: CurrentUserData): Promise<ActiveSessionDto[]> {
    const sessions = await this.refreshTokens.find({
      where: {
        accountId: user.accountId,
        revokedAt: IsNull(),
        expiresAt: MoreThan(new Date()),
      },
      order: { createdAt: 'DESC' },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
    });
    return sessions.map((s) => ({
      id: s.id,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      expiresAt: s.expiresAt,
    }));
  }

  /**
   * DELETE /auth/sessions/:sessionId — thu hồi đúng 1 phiên đăng nhập của chính user hiện tại.
   */
  async revokeSession(
    user: CurrentUserData,
    sessionId: string,
  ): Promise<RevokeSessionResponseDto> {
    const result = await this.refreshTokens.update(
      {
        id: sessionId,
        accountId: user.accountId,
        revokedAt: IsNull(),
      },
      { revokedAt: new Date() },
    );
    if (result.affected !== 1) {
      throw new NotFoundException('SESSION_NOT_FOUND');
    }
    return { success: true };
  }

  // ---- helpers ----

  private verifyEmailVerificationToken(email: string, token: string): Date {
    try {
      const payload = this.tokens.verifyEmailVerification(token);
      if (payload.email !== email) {
        throw new BadRequestException('EMAIL_VERIFICATION_TOKEN_INVALID');
      }
      return new Date();
    } catch (err) {
      if (err instanceof BadRequestException) {
        throw err;
      }
      throw new BadRequestException('EMAIL_VERIFICATION_TOKEN_INVALID');
    }
  }

  private generateOtpCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  private hashOtp(
    purpose: EmailOtpPurpose,
    email: string,
    otp: string,
  ): string {
    return this.tokens.hashToken(`${purpose}:${email}:${otp}`);
  }

  private hashesEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return timingSafeEqual(bufA, bufB);
  }

  private otpRepo(manager?: EntityManager): Repository<EmailOtp> {
    return manager ? manager.getRepository(EmailOtp) : this.emailOtps;
  }

  private async assertOtpCooldown(
    email: string,
    purpose: EmailOtpPurpose,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.otpRepo(manager);
    const latest = await repo.findOne({
      where: { email, purpose },
      order: { createdAt: 'DESC' },
    });
    if (!latest) return;

    const elapsedMs = Date.now() - latest.createdAt.getTime();
    const cooldownMs = OTP_COOLDOWN_SECONDS * 1000;
    if (elapsedMs < cooldownMs) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((cooldownMs - elapsedMs) / 1000),
      );
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          message: 'OTP_COOLDOWN',
          retryAfterSeconds,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async issueEmailOtp(
    email: string,
    purpose: EmailOtpPurpose,
    ttlMs: number,
    manager?: EntityManager,
  ): Promise<string> {
    await this.assertOtpCooldown(email, purpose, manager);
    const repo = this.otpRepo(manager);
    const otp = this.generateOtpCode();

    await repo.delete({ email, purpose });
    await repo.save(
      repo.create({
        email,
        purpose,
        codeHash: this.hashOtp(purpose, email, otp),
        attempts: 0,
        expiresAt: new Date(Date.now() + ttlMs),
      }),
    );
    return otp;
  }

  private async checkOtpRecord(
    repo: Repository<EmailOtp>,
    email: string,
    purpose: EmailOtpPurpose,
    otp: string,
  ): Promise<EmailOtp> {
    const record = await repo.findOne({
      where: { email, purpose, consumedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
    if (!record) {
      throw new BadRequestException('OTP_INVALID');
    }
    if (record.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('OTP_EXPIRED');
    }
    if (record.attempts >= OTP_MAX_ATTEMPTS) {
      throw new BadRequestException('OTP_MAX_ATTEMPTS');
    }

    const expectedHash = this.hashOtp(purpose, email, otp);
    if (!this.hashesEqual(expectedHash, record.codeHash)) {
      const nextAttempts = record.attempts + 1;
      await repo.update(
        { id: record.id, consumedAt: IsNull() },
        { attempts: nextAttempts },
      );
      if (nextAttempts >= OTP_MAX_ATTEMPTS) {
        throw new BadRequestException('OTP_MAX_ATTEMPTS');
      }
      throw new BadRequestException('OTP_INVALID');
    }
    return record;
  }

  private async verifyAndConsumeOtp(
    email: string,
    purpose: EmailOtpPurpose,
    otp: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = this.otpRepo(manager);
    const record = await this.checkOtpRecord(repo, email, purpose, otp);
    const now = new Date();
    const consumed = await repo.update(
      {
        id: record.id,
        consumedAt: IsNull(),
        expiresAt: MoreThan(now),
        attempts: LessThan(OTP_MAX_ATTEMPTS),
      },
      { consumedAt: now },
    );
    if (consumed.affected !== 1) {
      throw new BadRequestException('OTP_INVALID');
    }
  }

  private async loginExistingWithGoogle(
    account: Account,
    userAgent?: string,
  ): Promise<GoogleAuthResponseDto> {
    this.assertCanAuthenticate(account);
    if (!account.emailVerifiedAt) {
      const verifiedAt = new Date();
      account.emailVerifiedAt = verifiedAt;
      await this.accounts.update(
        { id: account.id },
        { emailVerifiedAt: verifiedAt },
      );
    }
    const tokens = await this.issueTokens(account, userAgent);
    return { ...tokens, isNewAccount: false };
  }

  // Cùng 1 luật với JWT guard: SUSPENDED bị chặn, PENDING vẫn vào để nộp hồ sơ kích hoạt.
  private assertCanAuthenticate(account: Account): void {
    if (!this.accountsService.isAllowedToAuthenticate(account)) {
      throw new ForbiddenException(
        account.status === 'SUSPENDED'
          ? 'ACCOUNT_SUSPENDED'
          : 'ACCOUNT_INACTIVE',
      );
    }
  }

  // Tạo ACCOUNT base (PENDING). UNIQUE(email) là chốt cuối khi 2 request cùng email chạy song song.
  // Mọi unique violation ở đây đều là email: phone/phone_hash để NULL (SĐT nộp ở bước kích hoạt).
  private async createAccount(
    input: {
      email: string;
      passwordHash: string;
      fullName: string;
      role: SelfRegisterRole;
      status?: 'ACTIVE' | 'PENDING';
      emailVerifiedAt?: Date | null;
    },
    manager?: EntityManager,
  ): Promise<Account> {
    const repo = manager ? manager.getRepository(Account) : this.accounts;
    try {
      return await repo.save(
        repo.create({
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          role: input.role,
          status: input.status ?? 'PENDING',
          emailVerifiedAt: input.emailVerifiedAt ?? null,
        }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('EMAIL_EXISTS');
      }
      throw err;
    }
  }

  // manager: chạy trong transaction của caller (reset mật khẩu).
  private async revokeAllSessions(
    accountId: string,
    manager: EntityManager = this.refreshTokens.manager,
  ): Promise<void> {
    await manager.update(
      RefreshToken,
      { accountId, revokedAt: IsNull() },
      { revokedAt: new Date() },
    );
  }

  /**
   * Cấp cặp access + refresh, lưu SHA-256(refresh) + hạn vào DB.
   * manager: dùng repo trong transaction khi gọi từ refresh.
   */
  private async issueTokens(
    account: Account,
    userAgent?: string,
    manager?: EntityManager,
  ): Promise<AuthTokensResponseDto> {
    const claims = { sub: account.id, role: account.role };
    const accessToken = this.tokens.signAccess(claims);
    const refreshToken = this.tokens.signRefresh(claims);
    const { exp } = this.tokens.verifyRefresh(refreshToken);

    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    // Dọn token ĐÃ HẾT HẠN của chính account mỗi lần cấp mới — bảng không phình vô hạn mà
    // không cần cron (Vercel serverless không giữ process). Token hết hạn vô dụng: JWT verify
    // đã từ chối trước khi tra DB, nên xoá không ảnh hưởng phát hiện reuse.
    await repo.delete({
      accountId: account.id,
      expiresAt: LessThan(new Date()),
    });
    await repo.save(
      repo.create({
        accountId: account.id,
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt: new Date((exp ?? 0) * 1000),
        // Cột varchar(255) — cắt để UA dài bất thường không làm hỏng đăng nhập.
        userAgent: userAgent?.slice(0, 255) ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      account: {
        id: account.id,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        status: account.status,
      },
    };
  }
}

// Mật khẩu tự sinh cho tài khoản tạo bằng Google: 12 ký tự base64url (~72 bit ngẫu nhiên),
// nằm trong luật 8–64 ký tự để người dùng dùng nó làm currentPassword khi đổi mật khẩu.
function generatePassword(): string {
  return randomBytes(9).toString('base64url');
}
