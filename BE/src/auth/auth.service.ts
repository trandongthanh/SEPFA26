import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, createHash } from 'crypto';
import { EntityManager, IsNull, LessThan, MoreThan, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import type { SelfRegisterRole } from '../common/constants/roles';
import { PasswordService } from '../crypto/password.service';
import { MailService, PASSWORD_RESET_LINK_MINUTES } from '../mail/mail.service';
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
import type { CurrentUserData } from './types/current-user.type';
import {
  AuthTokensResponseDto,
  ForgotPasswordResponseDto,
  GoogleAuthResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { EkycRecord } from '../ekyc/entities/ekyc-record.entity';
import { EkycService } from '../ekyc/ekyc.service';
import { CryptoService } from '../crypto/crypto.service';
import { RegisterWithEkycDto } from './dto/register-with-ekyc.dto';

// Postgres unique_violation — 2 request đăng ký cùng email chạy song song.
const PG_UNIQUE_VIOLATION = '23505';

const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_LINK_MINUTES * 60 * 1000;

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
    private readonly accountsService: AccountsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly mail: MailService,
    private readonly ekycService: EkycService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * POST /auth/register — tạo ACCOUNT base (status PENDING), KHÔNG tạo hồ sơ
   * customer/provider (thuộc bước kích hoạt). Không trả token: đăng nhập riêng.
   */
  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    if (await this.accounts.exists({ where: { email: dto.email } })) {
      throw new ConflictException('EMAIL_EXISTS');
    }
    // Băm (~300ms) trước khi ghi — không giữ connection DB trong lúc băm.
    const passwordHash = await this.passwords.hash(dto.password);
    const account = await this.createAccount({
      email: dto.email,
      passwordHash,
      fullName: dto.fullName,
      role: dto.role,
    });
    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
    };
  }

  /**
   * POST /auth/register-with-ekyc — Đăng ký tài khoản kèm eKYC tự động:
   * - Check trùng Email
   * - AI OCR bóc tách CCCD
   * - Check trùng số CCCD với các tài khoản khác
   * - AI Anti-Fraud kiểm tra thẻ giả
   * - AI Anti-Fraud Liveness kiểm tra người thật
   * - AI Face Matching sinh trắc học CCCD vs Selfie
   * - Tự động kích hoạt tài khoản: Account.status = 'ACTIVE'
   * - Tự động phê duyệt hồ sơ: CustomerProfile.verificationStatus = 'APPROVED'
   * - Tự động tạo EkycRecord với status: 'VERIFIED'
   * - Cấp tokens và trả kết quả để đăng nhập ngay lập tức.
   */
  async registerWithEkyc(
    dto: RegisterWithEkycDto,
    files: {
      cccdFront: Express.Multer.File;
      selfie: Express.Multer.File;
      cccdBack?: Express.Multer.File;
    },
    userAgent?: string,
  ) {
    if (await this.accounts.exists({ where: { email: dto.email } })) {
      throw new ConflictException('EMAIL_EXISTS');
    }

    // Chạy toàn bộ quy trình eKYC: OCR + check trùng CCCD + Fraud check + Face match + Cloudinary
    const ekycData = await this.ekycService.verifyAndProcessRegistrationEkyc(
      files.cccdFront,
      files.selfie,
      files.cccdBack,
    );

    // Băm mật khẩu
    const passwordHash = await this.passwords.hash(dto.password);

    // Xử lý số điện thoại nếu có
    let phoneEnc: string | null = null;
    let phoneHash: string | null = null;
    if (dto.phone?.trim()) {
      const cleanPhone = dto.phone.trim().replace(/[\s.()-]/g, '').replace(/^\+84/, '0').replace(/^84/, '0');
      phoneHash = createHash('sha256').update(cleanPhone).digest('hex');
      const dupPhone = await this.accounts.findOne({ where: { phoneHash } });
      if (dupPhone) {
        throw new ConflictException('Số điện thoại này đã được sử dụng bởi một tài khoản khác.');
      }
      phoneEnc = this.crypto.encrypt(cleanPhone);
    }

    // Ưu tiên tên người dùng nhập, nếu không có thì lấy tên chính xác do AI đọc từ thẻ CCCD
    const fullName = dto.fullName?.trim() || ekycData.fullName || 'Khách hàng';

    // 1. Tạo Account ở trạng thái ACTIVE (đã xác thực eKYC thành công, không cần Admin duyệt tay)
    const account = await this.accounts.save(
      this.accounts.create({
        email: dto.email,
        passwordHash,
        fullName,
        role: dto.role,
        phone: phoneEnc,
        phoneHash,
        status: 'ACTIVE',
      }),
    );

    // 2. Tạo CustomerProfile nếu là CUSTOMER với trạng thái APPROVED
    if (account.role === 'CUSTOMER') {
      const profile = this.customerProfiles.create({
        accountId: account.id,
        verificationStatus: 'APPROVED',
        verificationNote: 'eKYC tự động xác thực thành công khi đăng ký',
        cccdNumber: this.crypto.encrypt(ekycData.rawCccdNumber),
        cccdNumberHash: ekycData.cccdNumberHash,
        cccdFrontUrl: ekycData.frontUploadId,
        cccdBackUrl: ekycData.backUploadId,
        selfieWithIdUrl: ekycData.selfieUploadId,
      });
      await this.customerProfiles.save(profile);
    }

    // 3. Tạo bản ghi EkycRecord đã VERIFIED
    const ekycRecord = this.ekycRecords.create({
      accountId: account.id,
      status: 'VERIFIED',
      idDocType: ekycData.idDocType,
      idDocNumberEnc: this.crypto.encrypt(ekycData.rawCccdNumber),
      idDocNumberHash: ekycData.cccdNumberHash,
      fullNameExtracted: ekycData.fullName,
      dateOfBirth: ekycData.dateOfBirth,
      gender: ekycData.gender,
      nationality: ekycData.nationality,
      placeOfOrigin: ekycData.placeOfOrigin,
      frontImageUrl: ekycData.frontUploadId,
      backImageUrl: ekycData.backUploadId,
      selfieImageUrl: ekycData.selfieUploadId,
      faceMatch: true,
      faceSimilarity: ekycData.similarity.toFixed(2),
      fraudScore: ekycData.fraudScore?.toFixed(2) ?? null,
      livenessScore: ekycData.livenessScore?.toFixed(2) ?? null,
      antifraudDetails: ekycData.antifraudDetails as any,
      verifiedAt: new Date(),
    });
    await this.ekycRecords.save(ekycRecord);

    // 4. Cấp token đăng nhập luôn để FE/Mobile vào app trực tiếp
    const tokens = await this.issueTokens(account, userAgent);

    return {
      success: true,
      message: 'Đăng ký và xác thực eKYC thành công! Tài khoản đã được tự động kích hoạt.',
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
        idNumber: this.ekycService.maskIdNumber(ekycData.rawCccdNumber),
        similarity: Number(ekycData.similarity.toFixed(2)),
      },
      tokens,
    };
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
        return true;
      },
    );
    if (!done) {
      throw new BadRequestException('RESET_TOKEN_INVALID');
    }
  }

  // ---- helpers ----

  private async loginExistingWithGoogle(
    account: Account,
    userAgent?: string,
  ): Promise<GoogleAuthResponseDto> {
    this.assertCanAuthenticate(account);
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
  private async createAccount(input: {
    email: string;
    passwordHash: string;
    fullName: string;
    role: SelfRegisterRole;
    status?: 'ACTIVE' | 'PENDING';
  }): Promise<Account> {
    try {
      return await this.accounts.save(
        this.accounts.create({
          email: input.email,
          passwordHash: input.passwordHash,
          fullName: input.fullName,
          role: input.role,
          status: input.status ?? 'PENDING',
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
