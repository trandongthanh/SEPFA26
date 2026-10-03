import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'crypto';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import type { SelfRegisterRole } from '../common/constants/roles';
import { PasswordService } from '../crypto/password.service';
import { MailService } from '../mail/mail.service';
import { RefreshToken } from './entities/refresh-token.entity';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';
import { TokenService, type JwtPayload } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import type { CurrentUserData } from './types/current-user.type';
import {
  AuthTokensResponseDto,
  GoogleAuthResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

// Postgres unique_violation — 2 request đăng ký cùng email chạy song song.
const PG_UNIQUE_VIOLATION = '23505';

/**
 * Nghiệp vụ xác thực: đăng ký, đăng nhập (email/mật khẩu và Google), làm mới phiên, đăng xuất.
 *
 * Quy ước chung (đọc trước khi sửa):
 * - ACCOUNT là tài khoản "base": đăng ký chỉ tạo 1 dòng accounts (status PENDING), KHÔNG tạo
 *   hồ sơ customer/provider. SĐT, CCCD, hồ sơ thuộc bước KÍCH HOẠT (module customers/providers/ekyc).
 * - Luật "ai được đăng nhập" nằm DUY NHẤT ở AccountsService.isAllowedToAuthenticate
 *   (dùng chung cho login, Google, refresh và JWT guard) — đổi luật thì sửa ở đó.
 * - Phiên = refresh token, lưu ở bảng refresh_tokens dưới dạng SHA-256 (không lưu token thô).
 *   Access token KHÔNG lưu DB: tự hết hạn (JWT_ACCESS_EXPIRES), guard tra account mỗi request.
 * - Tài khoản tạo bằng Google vẫn có mật khẩu (tự sinh, gửi qua mail) → đăng nhập được cả 2 cách;
 *   không có bảng liên kết Google riêng, tài khoản được nhận diện theo EMAIL.
 */
@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly accountsService: AccountsService,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly google: GoogleIdTokenVerifier,
    private readonly mail: MailService,
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
  }): Promise<Account> {
    try {
      return await this.accounts.save(
        this.accounts.create({ ...input, status: 'PENDING' }),
      );
    } catch (err) {
      if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
        throw new ConflictException('EMAIL_EXISTS');
      }
      throw err;
    }
  }

  private async revokeAllSessions(accountId: string): Promise<void> {
    await this.refreshTokens.update(
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
