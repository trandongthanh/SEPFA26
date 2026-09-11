import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../crypto/password.service';
import { TokenService, type JwtPayload } from './token.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterProviderDto } from './dto/register-provider.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import type { CurrentUserData } from './types/current-user.type';
import {
  AuthTokensResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(RefreshToken)
    private readonly refreshTokens: Repository<RefreshToken>,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly crypto: CryptoService,
    private readonly dataSource: DataSource,
    private readonly accountsService: AccountsService,
  ) {}

  /**
   * Đăng ký tài khoản mới. Trong 1 transaction: tạo ACCOUNT + hồ sơ rỗng tương ứng
   * role (CUSTOMER_PROFILE hoặc PROVIDER_PROFILE) — tài khoản luôn có hồ sơ đi kèm
   * ngay từ đầu, tránh phải kiểm tra "hồ sơ null" rải rác ở các module khác.
   */
  async register(dto: RegisterDto): Promise<RegisterResponseDto> {
    const exists = await this.accounts.findOne({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException('EMAIL_EXISTS');
    }
    if (dto.role === 'PROVIDER' && !dto.providerType) {
      throw new BadRequestException('PROVIDER_TYPE_REQUIRED');
    }
    if (
      dto.role === 'PROVIDER' &&
      (dto.gpsLat === undefined || dto.gpsLng === undefined)
    ) {
      throw new BadRequestException('PROVIDER_LOCATION_REQUIRED');
    }
    const phoneHash = this.phoneHash(dto.phone);
    if (await this.accounts.findOne({ where: { phoneHash } })) {
      throw new ConflictException('PHONE_EXISTS');
    }

    // B12: băm mật khẩu (~300ms) TRƯỚC khi mở transaction — không giữ connection DB trong lúc băm.
    const passwordHash = await this.passwords.hash(dto.password);

    const account = await this.dataSource.transaction(async (manager) => {
      const account = await manager.save(
        manager.create(Account, {
          email: dto.email,
          passwordHash,
          fullName: dto.fullName,
          phone: this.crypto.encrypt(dto.phone),
          phoneHash,
          role: dto.role,
          // Customer và Provider đều cần admin duyệt hồ sơ mới được ACTIVE.
          status: 'PENDING',
        }),
      );

      if (dto.role === 'CUSTOMER') {
        await manager.save(
          manager.create(CustomerProfile, { accountId: account.id }),
        );
      } else {
        // displayName khởi tạo = fullName; provider tự sửa lại sau qua PUT /providers/me/profile.
        await manager.save(
          manager.create(ProviderProfile, {
            accountId: account.id,
            providerType: dto.providerType,
            displayName: dto.fullName,
            address: dto.address?.trim() || null,
            gpsLat: String(dto.gpsLat),
            gpsLng: String(dto.gpsLng),
            verificationStatus: 'PENDING',
          }),
        );
      }

      return account;
    });

    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
    };
  }

  /**
   * Đăng ký riêng dành cho Provider (POST /auth/register-provider)
   * Lưu đầy đủ thông tin vào bảng accounts và bảng provider_profiles với verification_status = 'PENDING'
   */
  async registerProvider(
    dto: RegisterProviderDto,
  ): Promise<RegisterResponseDto> {
    const exists = await this.accounts.findOne({ where: { email: dto.email } });
    if (exists) {
      throw new ConflictException('EMAIL_EXISTS');
    }

    const account = await this.dataSource.transaction(async (manager) => {
      const account = await manager.save(
        manager.create(Account, {
          email: dto.email,
          passwordHash: await this.passwords.hash(
            Math.random().toString(36).slice(-16),
          ),
          fullName: dto.name,
          phone: dto.phone ? this.crypto.encrypt(dto.phone) : null,
          role: 'PROVIDER',
          status: 'PENDING',
        }),
      );

      await manager.save(
        manager.create(ProviderProfile, {
          accountId: account.id,
          providerType: dto.providerType,
          displayName: dto.name,
          bio: dto.introduction ?? null,
          address: dto.address ?? null,
          portfolioUrl: null,
          selfieUrl: dto.selfieUrl ?? null,
          experience: dto.experience ?? null,
          specialties: dto.specialties ?? null,
          serviceAreas: dto.serviceAreas ?? null,
          certificates: dto.certificates ?? null,
          bankName: dto.bankName ?? null,
          bankAccount: dto.bankAccount ?? null,
          bankHolder: dto.bankHolder ?? null,
          // 4 URL chứng từ / ảnh nhận diện
          cccdFrontUrl: dto.cccdFrontUrl ?? null,
          cccdBackUrl: dto.cccdBackUrl ?? null,
          businessLicenseUrl: dto.businessLicenseUrl ?? null,
          verificationStatus: 'PENDING',
        }),
      );

      return account;
    });

    return {
      accountId: account.id,
      email: account.email,
      role: account.role,
      status: account.status,
    };
  }

  /**
   * Đăng nhập bằng email + mật khẩu.
   * - Sai email HOẶC sai mật khẩu → 401 INVALID_CREDENTIALS (gộp lỗi để chống dò email).
   * - Tài khoản bị khóa → 403 ACCOUNT_SUSPENDED.
   * - Thành công → cấp cặp token và lưu refresh token vào DB (qua issueTokens).
   * @param userAgent chuỗi User-Agent của thiết bị (lưu để quản lý phiên; có thể trống).
   */
  async login(
    dto: LoginDto,
    userAgent?: string,
  ): Promise<AuthTokensResponseDto> {
    const account = await this.accounts.findOne({
      where: { email: dto.email },
    });
    // B2: LUÔN chạy bcrypt (email sai thì so với hash mồi) — thời gian phản hồi
    // đồng đều, không lộ email nào tồn tại qua timing.
    const passwordOk = await this.passwords.compare(
      dto.password,
      account?.passwordHash ?? this.passwords.dummyHash,
    );
    if (!account || !passwordOk) {
      throw new UnauthorizedException('INVALID_CREDENTIALS');
    }
    // B7: chặn MỌI trạng thái ≠ ACTIVE (login/refresh/guard cùng 1 định nghĩa),
    // mã lỗi phân biệt để FE không rơi vào vòng lặp 401.
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      throw new ForbiddenException(
        account.status === 'SUSPENDED'
          ? 'ACCOUNT_SUSPENDED'
          : 'ACCOUNT_INACTIVE',
      );
    }

    return this.issueTokens(account, userAgent);
  }

  /**
   * Làm mới cặp token bằng refresh token (rotation — token cũ dùng 1 lần).
   * - Verify chữ ký/hạn trước (rẻ, không chạm DB); sai → 401 INVALID_REFRESH_TOKEN.
   * - Không khớp bản ghi DB → 401 INVALID_REFRESH_TOKEN.
   * - Bản ghi đã bị revoke mà vẫn được dùng lại → dấu hiệu token bị lộ (reuse attack):
   *   revoke TOÀN BỘ token của account rồi 401 REFRESH_TOKEN_REUSED, buộc login lại mọi thiết bị.
   * - Hợp lệ → revoke token cũ, cấp cặp mới (issueTokens).
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
    // Đối xứng với JwtStrategy chặn refresh token dùng làm access token —
    // phòng thủ độc lập, không dựa vào việc access/refresh secret luôn khác nhau.
    if (payload.type !== 'refresh') {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    const tokenHash = this.tokens.hashToken(dto.refreshToken);
    const record = await this.refreshTokens.findOne({ where: { tokenHash } });
    if (!record) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    if (record.revokedAt) {
      await this.refreshTokens.update(
        { accountId: record.accountId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      throw new UnauthorizedException('REFRESH_TOKEN_REUSED');
    }

    const account = await this.accounts.findOne({
      where: { id: payload.sub },
    });
    // B7: tài khoản không còn ACTIVE thì không cho làm mới phiên.
    if (!account || !this.accountsService.isAllowedToAuthenticate(account)) {
      throw new UnauthorizedException('INVALID_REFRESH_TOKEN');
    }

    // B1+B4: thu hồi token cũ + cấp token mới trong 1 transaction.
    return this.dataSource.transaction(async (manager) => {
      // Thu hồi NGUYÊN TỬ: chỉ bản ghi còn sống mới bị huỷ, chỉ 1 request thắng.
      const revoke = await manager.update(
        RefreshToken,
        { tokenHash, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
      // B1: thua cuộc (đã bị request song song xoay vòng trước) → coi như token bị dùng lại.
      if (revoke.affected !== 1) {
        await manager.update(
          RefreshToken,
          { accountId: record.accountId, revokedAt: IsNull() },
          { revokedAt: new Date() },
        );
        throw new UnauthorizedException('REFRESH_TOKEN_REUSED');
      }
      return this.issueTokens(account, userAgent, manager);
    });
  }

  /**
   * Đăng xuất — thu hồi refresh token. accessToken (đã qua JwtAuthGuard) xác định
   * AI đang gọi; refreshToken trong body chỉ là đối tượng cần thu hồi, không dùng để xác thực.
   * - Có refreshToken → thu hồi đúng 1 token đó (ràng buộc theo accountId, tránh revoke nhầm
   *   token của account khác dù chuỗi bị lộ).
   * - Không có refreshToken → thu hồi toàn bộ token còn sống của account (logout mọi thiết bị).
   * Idempotent: không tìm thấy token khớp vẫn trả success (trạng thái đích đã đạt được).
   */
  async logout(
    user: CurrentUserData,
    dto: LogoutDto,
  ): Promise<LogoutResponseDto> {
    if (dto.refreshToken) {
      const tokenHash = this.tokens.hashToken(dto.refreshToken);
      await this.refreshTokens.update(
        { accountId: user.accountId, tokenHash, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    } else {
      await this.refreshTokens.update(
        { accountId: user.accountId, revokedAt: IsNull() },
        { revokedAt: new Date() },
      );
    }

    return { success: true };
  }

  /**
   * Cấp cặp access + refresh token, đồng thời LƯU hash(refresh) vào DB.
   * Dùng chung cho login và refresh (rotation) để tránh lặp logic.
   * Refresh token lưu dạng SHA-256 (không lưu thô) kèm hạn (đọc exp từ token).
   */
  private async issueTokens(
    account: Account,
    userAgent?: string,
    manager?: EntityManager,
  ): Promise<AuthTokensResponseDto> {
    const accessToken = this.tokens.signAccess({
      sub: account.id,
      role: account.role,
    });
    const refreshToken = this.tokens.signRefresh({
      sub: account.id,
      role: account.role,
    });

    // Dùng chung repo hay repo trong transaction (khi refresh gọi kèm manager).
    const repo = manager
      ? manager.getRepository(RefreshToken)
      : this.refreshTokens;
    // exp là giây (chuẩn JWT) → *1000 đổi sang mili-giây cho Date.
    const { exp } = this.tokens.verifyRefresh(refreshToken);
    await repo.save(
      repo.create({
        accountId: account.id,
        tokenHash: this.tokens.hashToken(refreshToken),
        expiresAt: new Date((exp ?? 0) * 1000),
        userAgent: userAgent ?? null,
      }),
    );

    return {
      accessToken,
      refreshToken,
      account: {
        id: account.id,
        fullName: account.fullName,
        role: account.role,
      },
    };
  }

  private phoneHash(phone: string): string {
    const normalized = phone
      .replace(/[\s.()-]/g, '')
      .replace(/^\+84/, '0')
      .replace(/^84/, '0');
    return createHash('sha256').update(normalized).digest('hex');
  }
}
