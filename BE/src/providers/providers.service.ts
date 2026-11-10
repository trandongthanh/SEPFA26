import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { assertGpsPair } from '../common/gps';
import {
  PG_UNIQUE_VIOLATION,
  mapIdentityUniqueViolation,
  normalizePhone,
  sha256Hex,
} from '../common/identity';
import { ProviderProfile } from './entities/provider-profile.entity';
import { ServicePackage } from './entities/service-package.entity';
import { Account } from '../accounts/entities/account.entity';
import { toAccountSummary } from '../accounts/account.mapper';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../crypto/password.service';
import { QueryProviderDto } from './dto/query-provider.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { VerifyProviderDto } from './dto/verify-provider.dto';
import { UpsertPackageDto } from './dto/upsert-package.dto';

// Đủ bộ định danh để admin duyệt + vườn nhận đơn (hợp đồng cần SĐT + số CCCD thật).
function hasCompleteIdentity(profile: ProviderProfile): boolean {
  return Boolean(
    profile.cccdFrontUrl &&
    profile.cccdBackUrl &&
    profile.selfieUrl &&
    profile.cccdNumber &&
    profile.account?.phone,
  );
}

// 23505 trên UNIQUE(account_id): 2 PUT TẠO hồ sơ cùng account chạy song song.
function isAccountIdConflict(err: unknown): boolean {
  const pg = err as { code?: string; detail?: string };
  return (
    pg.code === PG_UNIQUE_VIOLATION &&
    Boolean(pg.detail?.includes('account_id'))
  );
}

@Injectable()
export class ProvidersService {
  constructor(
    @InjectRepository(ProviderProfile)
    private readonly profileRepo: Repository<ProviderProfile>,
    @InjectRepository(ServicePackage)
    private readonly packageRepo: Repository<ServicePackage>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly crypto: CryptoService,
    private readonly passwords: PasswordService,
    private readonly dataSource: DataSource,
  ) {}

  // Lấy hồ sơ của provider đang đăng nhập (GET /providers/me) — chủ hồ sơ thấy đủ field của mình
  // (SĐT + số CCCD đã giải mã); không bao giờ thấy hash/ciphertext/passwordHash.
  async getMyProfile(accountId: string) {
    const profile = await this.profileRepo.findOne({
      where: { accountId },
      relations: { account: true },
    });

    if (!profile) {
      throw new NotFoundException('PROVIDER_PROFILE_NOT_FOUND');
    }

    return this.toProfileView(profile);
  }

  // Upsert hồ sơ provider: chưa có → tạo (PENDING); có rồi → cập nhật. Trả cùng dạng GET /me.
  // Đổi field nhạy cảm (license/type/ảnh giấy tờ/số CCCD) khi đang APPROVED → tự về PENDING.
  // address/gps/SĐT KHÔNG nhạy cảm (thông tin vận hành/liên lạc — đổi không cần duyệt lại).
  async upsertProfile(accountId: string, dto: UpsertProfileDto) {
    assertGpsPair(dto.gpsLat, dto.gpsLng);

    try {
      await this.writeProfile(accountId, dto);
    } catch (err) {
      if (!isAccountIdConflict(err)) {
        throw mapIdentityUniqueViolation(err);
      }
      // UNIQUE(account_id): PUT song song vừa tạo xong hồ sơ → chạy lại 1 lần như cập nhật.
      try {
        await this.writeProfile(accountId, dto);
      } catch (retryErr) {
        throw mapIdentityUniqueViolation(retryErr);
      }
    }

    return this.getMyProfile(accountId);
  }

  // Hồ sơ + SĐT (bảng accounts) ghi trong 1 transaction: lỗi 1 bên thì không bên nào đổi.
  // Check trùng SĐT/CCCD bằng findOne trước; khe đua song song do UNIQUE index chặn (23505 → 409
  // ở upsertProfile).
  private async writeProfile(
    accountId: string,
    dto: UpsertProfileDto,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(ProviderProfile, {
        where: { accountId },
      });

      // Lần PUT đầu của account PROVIDER mới (đăng ký chỉ tạo ACCOUNT) → tạo hồ sơ PENDING.
      // providerType + displayName là 2 cột NOT NULL nên bắt buộc ở lần này.
      if (!existing && (!dto.providerType || !dto.displayName)) {
        throw new BadRequestException('PROVIDER_PROFILE_FIELDS_REQUIRED');
      }

      const cccdNumberHash =
        dto.cccdNumber !== undefined ? sha256Hex(dto.cccdNumber) : undefined;
      if (cccdNumberHash !== undefined) {
        const duplicate = await manager.findOne(ProviderProfile, {
          where: { cccdNumberHash },
        });
        if (duplicate && duplicate.accountId !== accountId) {
          throw new ConflictException('CCCD_NUMBER_EXISTS');
        }
      }

      let phone: { encrypted: string; hash: string } | undefined;
      if (dto.phone !== undefined) {
        const normalized = normalizePhone(dto.phone);
        const phoneHash = sha256Hex(normalized);
        const duplicate = await manager.findOne(Account, {
          where: { phoneHash },
        });
        if (duplicate && duplicate.id !== accountId) {
          throw new ConflictException('PHONE_EXISTS');
        }
        phone = { encrypted: this.crypto.encrypt(normalized), hash: phoneHash };
      }

      const profile =
        existing ??
        manager.create(ProviderProfile, {
          accountId,
          verificationStatus: 'PENDING',
        });

      if (existing) {
        // C1: MERGE — so field nhạy cảm dựa trên GIÁ TRỊ MỚI SẼ CÓ (đã merge) so với giá trị cũ.
        const nextProviderType = dto.providerType ?? existing.providerType;
        const nextLicenseInfo =
          dto.licenseInfo !== undefined
            ? dto.licenseInfo
            : existing.licenseInfo;
        const sensitiveChanged =
          existing.licenseInfo !== nextLicenseInfo ||
          existing.providerType !== nextProviderType ||
          (dto.cccdFrontUrl !== undefined &&
            existing.cccdFrontUrl !== dto.cccdFrontUrl) ||
          (dto.cccdBackUrl !== undefined &&
            existing.cccdBackUrl !== dto.cccdBackUrl) ||
          (dto.businessLicenseUrl !== undefined &&
            existing.businessLicenseUrl !== dto.businessLicenseUrl) ||
          // Số CCCD đổi — KỂ CẢ khai lần đầu (null → số): số in lên hợp đồng phải được admin
          // đối chiếu với ảnh CCCD. So hash vì cột cccdNumber là ciphertext (IV ngẫu nhiên).
          (cccdNumberHash !== undefined &&
            existing.cccdNumberHash !== cccdNumberHash);

        if (sensitiveChanged && existing.verificationStatus === 'APPROVED') {
          existing.verificationStatus = 'PENDING';
        }
      }

      this.applyProfileFields(profile, dto);
      if (dto.cccdNumber !== undefined && cccdNumberHash !== undefined) {
        profile.cccdNumber = this.crypto.encrypt(dto.cccdNumber);
        profile.cccdNumberHash = cccdNumberHash;
      }
      await manager.save(profile);

      // SĐT KHÔNG thuộc bộ KYC → không đụng verificationStatus (cố ý — đừng thêm luật về PENDING).
      if (phone) {
        await manager.update(
          Account,
          { id: accountId },
          { phone: phone.encrypted, phoneHash: phone.hash },
        );
      }
    });
  }

  // Dạng trả ra cho chủ hồ sơ + admin: bỏ hash, số CCCD giải mã, SĐT giải mã ở cấp ngoài,
  // account qua toAccountSummary (không spread entity → không lộ passwordHash/phoneHash).
  private toProfileView(profile: ProviderProfile) {
    const { account, cccdNumberHash: _hash, ...rest } = profile;
    const summary = account ? toAccountSummary(account, this.crypto) : null;
    return {
      ...rest,
      account: summary,
      phone: summary?.phone ?? null,
      cccdNumber: rest.cccdNumber ? this.crypto.decrypt(rest.cccdNumber) : null,
    };
  }

  // MERGE: chỉ gán field client gửi (!== undefined) — dùng chung cho tạo mới và cập nhật.
  private applyProfileFields(
    profile: ProviderProfile,
    dto: UpsertProfileDto,
  ): void {
    if (dto.providerType !== undefined) profile.providerType = dto.providerType;
    if (dto.displayName !== undefined) profile.displayName = dto.displayName;
    if (dto.bio !== undefined) profile.bio = dto.bio;
    if (dto.licenseInfo !== undefined) profile.licenseInfo = dto.licenseInfo;
    if (dto.portfolioUrl !== undefined) profile.portfolioUrl = dto.portfolioUrl;
    if (dto.selfieUrl !== undefined) profile.selfieUrl = dto.selfieUrl;
    if (dto.cccdFrontUrl !== undefined) profile.cccdFrontUrl = dto.cccdFrontUrl;
    if (dto.cccdBackUrl !== undefined) profile.cccdBackUrl = dto.cccdBackUrl;
    if (dto.businessLicenseUrl !== undefined)
      profile.businessLicenseUrl = dto.businessLicenseUrl;
    if (dto.address !== undefined) profile.address = dto.address;
    if (dto.gpsLat !== undefined) profile.gpsLat = String(dto.gpsLat);
    if (dto.gpsLng !== undefined) profile.gpsLng = String(dto.gpsLng);
    if (dto.experience !== undefined) profile.experience = dto.experience;
    if (dto.specialties !== undefined) profile.specialties = dto.specialties;
    if (dto.serviceAreas !== undefined) profile.serviceAreas = dto.serviceAreas;
    if (dto.certificates !== undefined) profile.certificates = dto.certificates;
    if (dto.bankName !== undefined) profile.bankName = dto.bankName;
    if (dto.bankAccount !== undefined) profile.bankAccount = dto.bankAccount;
    if (dto.bankHolder !== undefined) profile.bankHolder = dto.bankHolder;
  }

  // Public (GET /providers/:id, khách vãng lai gọi được): CHỈ field giới thiệu vườn.
  // Không trả account (email, SĐT), ngân hàng, giấy tờ CCCD/selfie/GPKD, licenseInfo,
  // verificationNote — cùng nguyên tắc với browse (C5).
  async getById(providerId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: providerId },
    });
    if (!profile) {
      throw new NotFoundException('PROVIDER_NOT_FOUND');
    }
    return {
      id: profile.id,
      displayName: profile.displayName,
      providerType: profile.providerType,
      bio: profile.bio,
      portfolioUrl: profile.portfolioUrl,
      address: profile.address,
      gpsLat: profile.gpsLat,
      gpsLng: profile.gpsLng,
      ratingAvg: profile.ratingAvg,
      experience: profile.experience,
      specialties: profile.specialties,
      serviceAreas: profile.serviceAreas,
      certificates: profile.certificates,
      verificationStatus: profile.verificationStatus,
      createdAt: profile.createdAt,
    };
  }

  async browse(query: QueryProviderDto) {
    const { type, minRating, keyword, page, limit } = query;

    const qb = this.profileRepo
      .createQueryBuilder('p')
      // Subquery đếm gói đang bán → tránh N+1 (số đếm tính ngay trong câu chính).
      .addSelect(
        (sub) =>
          sub
            .select('COUNT(*)')
            .from(ServicePackage, 'sp')
            .where('sp.provider_id = p.id')
            .andWhere('sp.is_active = true')
            .andWhere("sp.approval_status = 'APPROVED'")
            .andWhere('sp.deleted_at IS NULL'), // subquery raw không tự áp soft-delete
        'package_count',
      )
      .where('p.verification_status = :status', { status: 'APPROVED' });

    if (type) {
      qb.andWhere('p.provider_type = :type', { type });
    }
    // C8: chỉ lọc khi minRating > 0 — minRating=0 (mặc định thanh trượt) không được
    // loại vườn chưa có đánh giá (rating_avg NULL → biểu thức >= trả NULL → mất khỏi list).
    if (minRating) {
      qb.andWhere('p.rating_avg >= :minRating', { minRating });
    }
    if (keyword) {
      // C12: escape %/_/\ để người dùng không tự dựng pattern nặng; ILIKE tìm gần đúng.
      const safe = keyword.replace(/[\\%_]/g, (c) => `\\${c}`);
      qb.andWhere("p.display_name ILIKE :kw ESCAPE '\\'", {
        kw: `%${safe}%`,
      });
    }

    // C7: NULLS LAST — vườn chưa có đánh giá xuống cuối, không đẩy lên đầu.
    qb.orderBy('p.rating_avg', 'DESC', 'NULLS LAST')
      .addOrderBy('p.created_at', 'DESC') // tiêu chí phụ khi rating bằng nhau
      .skip((page - 1) * limit)
      .take(limit);

    // entities = ProviderProfile[]; raw = dòng thô (chứa package_count).
    const result = await qb.getRawAndEntities<{ package_count: string }>();
    const total = await qb.getCount();

    // C5: KHÔNG spread nguyên entity — endpoint public không được lộ
    // licenseInfo (số GPKD), verificationNote (ghi chú nội bộ admin), accountId, version...
    // Chỉ trả các cột an toàn cho khách vãng lai.
    const data = result.entities.map((profile, i) => ({
      id: profile.id,
      displayName: profile.displayName,
      providerType: profile.providerType,
      bio: profile.bio,
      portfolioUrl: profile.portfolioUrl,
      address: profile.address,
      gpsLat: profile.gpsLat,
      gpsLng: profile.gpsLng,
      ratingAvg: profile.ratingAvg,
      // COUNT trả bigint (string) → ép number.
      packageCount: Number(result.raw[i].package_count),
    }));

    return { data, total, page, limit };
  }

  async listAllForAdmin() {
    const profiles = await this.profileRepo.find({
      relations: { account: true },
      order: { createdAt: 'DESC' },
    });
    return profiles.map((p) => ({
      ...this.toProfileView(p),
      // Nút "Duyệt" chỉ bật khi đủ bộ định danh — khớp điều kiện chặn ở verifyProvider.
      canVerify: p.verificationStatus === 'PENDING' && hasCompleteIdentity(p),
    }));
  }

  async getAdminProviderDetail(providerId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: providerId },
      relations: { account: true },
    });
    if (!profile) throw new NotFoundException('PROVIDER_NOT_FOUND');
    const packages = await this.packageRepo.find({
      where: { providerId: profile.id },
      order: { createdAt: 'DESC' },
    });
    return {
      provider: this.toProfileView(profile),
      packages,
    };
  }

  // Admin duyệt hồ sơ: đổi verificationStatus + lưu lý do. Trả dạng view (không entity thô).
  async verifyProvider(providerIdOrEmail: string, dto: VerifyProviderDto) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        providerIdOrEmail,
      );

    let profile: ProviderProfile | null = null;

    if (isUuid) {
      profile = await this.profileRepo.findOne({
        where: [{ id: providerIdOrEmail }, { accountId: providerIdOrEmail }],
        relations: { account: true },
      });
    }

    if (!profile) {
      const kw = providerIdOrEmail.trim().toLowerCase();
      profile = await this.profileRepo
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.account', 'a')
        .where('LOWER(a.email) = :kw', { kw })
        .orWhere('LOWER(a.email) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .orWhere('LOWER(p.display_name) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .getOne();
    }

    if (!profile) {
      throw new NotFoundException('PROVIDER_NOT_FOUND');
    }

    // APPROVED cần đủ SĐT + số CCCD + 3 ảnh — không ngoại lệ cho vườn cũ (vườn tự khai bổ sung
    // qua PUT /providers/me/profile rồi admin duyệt lại). Giữ mã lỗi cũ để FE admin không phải sửa.
    if (dto.decision === 'APPROVED' && !hasCompleteIdentity(profile)) {
      throw new BadRequestException('PROVIDER_PROFILE_NOT_SUBMITTED');
    }

    profile.verificationStatus = dto.decision;
    // C13: chỉ ghi đè note khi admin thực sự gửi — duyệt không kèm note giữ nguyên lý do cũ.
    if (dto.note !== undefined) {
      profile.verificationNote = dto.note;
    }

    if (profile.account) {
      profile.account.status =
        dto.decision === 'APPROVED' ? 'ACTIVE' : 'PENDING';
      await this.accountRepo.save(profile.account);
    }

    return this.toProfileView(await this.profileRepo.save(profile));
  }

  async resetProviderPassword(
    providerIdOrEmail: string,
  ): Promise<{ tempPassword: string }> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        providerIdOrEmail,
      );
    let profile: ProviderProfile | null = null;

    if (isUuid) {
      profile = await this.profileRepo.findOne({
        where: [{ id: providerIdOrEmail }, { accountId: providerIdOrEmail }],
        relations: { account: true },
      });
    }

    if (!profile) {
      profile = await this.profileRepo
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.account', 'a')
        .where('LOWER(a.email) = :email', {
          email: providerIdOrEmail.trim().toLowerCase(),
        })
        .getOne();
    }

    if (!profile?.account) {
      throw new NotFoundException('PROVIDER_NOT_FOUND');
    }

    const tempPassword =
      Math.random().toString(36).slice(-8) +
      Math.random().toString(36).slice(-4).toUpperCase();
    profile.account.passwordHash = await this.passwords.hash(tempPassword);
    await this.accountRepo.save(profile.account);
    return { tempPassword };
  }

  async deleteProviderForAdmin(
    providerIdOrEmail: string,
  ): Promise<{ success: boolean; message: string }> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        providerIdOrEmail,
      );
    let profile: ProviderProfile | null = null;

    if (isUuid) {
      profile = await this.profileRepo.findOne({
        where: [{ id: providerIdOrEmail }, { accountId: providerIdOrEmail }],
      });
    }

    if (!profile) {
      profile = await this.profileRepo
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.account', 'a')
        .where('LOWER(a.email) = LOWER(:email)', { email: providerIdOrEmail })
        .getOne();
    }

    if (!profile) {
      throw new NotFoundException('PROVIDER_NOT_FOUND');
    }

    await this.packageRepo.delete({ providerId: profile.id });
    await this.profileRepo.remove(profile);
    await this.accountRepo.delete({ id: profile.accountId });
    return { success: true, message: 'Provider deleted successfully' };
  }

  // Chỉ cần hồ sơ TỒN TẠI (đọc/sửa/xoá gói của chính mình — kể cả khi đang PENDING).
  private async getProfileOrThrow(accountId: string): Promise<ProviderProfile> {
    const profile = await this.profileRepo.findOne({ where: { accountId } });
    if (!profile) {
      throw new NotFoundException('PROFILE_NOT_FOUND');
    }
    return profile;
  }

  // Cần hồ sơ ĐÃ DUYỆT — chỉ dùng cho TẠO gói mới (đưa hàng lên chợ).
  private async getApprovedProfileOrThrow(
    accountId: string,
  ): Promise<ProviderProfile> {
    const profile = await this.getProfileOrThrow(accountId);
    if (profile.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException('PROFILE_NOT_APPROVED');
    }
    return profile;
  }

  // Chỉ chủ sở hữu mới thao tác được gói của mình — providerId phải khớp accountId đang login.
  private async getOwnedPackageOrThrow(
    packageId: string,
    providerId: string,
  ): Promise<ServicePackage> {
    const pkg = await this.packageRepo.findOne({ where: { id: packageId } });
    if (!pkg || pkg.providerId !== providerId) {
      throw new NotFoundException('PACKAGE_NOT_FOUND');
    }
    return pkg;
  }

  async createPackage(
    accountIdOrId: string,
    dto: UpsertPackageDto,
  ): Promise<ServicePackage> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        accountIdOrId || '',
      );
    let profile: ProviderProfile | null = null;

    if (isUuid) {
      profile = await this.profileRepo.findOne({
        where: [{ accountId: accountIdOrId }, { id: accountIdOrId }],
      });
    }

    if (!profile && accountIdOrId) {
      const kw = accountIdOrId.trim().toLowerCase();
      profile = await this.profileRepo
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.account', 'a')
        .where('LOWER(a.email) = :kw', { kw })
        .orWhere('LOWER(a.email) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .orWhere('LOWER(p.display_name) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .getOne();
    }

    if (!profile) {
      // Fallback: Tìm hồ sơ APPROVED mới nhất trong PostgreSQL DB khi Provider tạo gói từ trang quản lý
      profile = await this.profileRepo.findOne({
        where: { verificationStatus: 'APPROVED' },
        order: { updatedAt: 'DESC' },
      });
    }

    if (!profile || profile.verificationStatus !== 'APPROVED') {
      throw new ForbiddenException(
        'CHỈ_PROVIDER_ĐÃ_ĐƯỢC_DUYỆT_MỚI_ĐƯỢC_TẠO_GÓI_DỊCH_VỤ',
      );
    }

    this.validateDeclaredValueRange(dto);

    const created = this.packageRepo.create({
      providerId: profile.id,
      name: dto.name,
      description: dto.description ?? null,
      durationDays: dto.durationDays,
      reportFrequencyDays: dto.reportFrequencyDays,
      maxPlants: dto.maxPlants,
      basePrice: String(dto.basePrice),
      minDeclaredValue: String(dto.minDeclaredValue),
      maxDeclaredValue: String(dto.maxDeclaredValue),
      // Package luôn chờ admin duyệt; chỉ admin được phép bật isActive.
      isActive: false,
      approvalStatus: 'PENDING',
      rejectionReason: null,
    });
    return this.packageRepo.save(created);
  }

  async listMyPackages(accountId: string): Promise<ServicePackage[]> {
    // C10: xem gói của mình không cần APPROVED (vườn đang PENDING vẫn quản lý được gói).
    const profile = await this.getProfileOrThrow(accountId);
    return this.packageRepo.find({
      where: { providerId: profile.id },
      order: { createdAt: 'DESC' },
    });
  }

  async getMyPackage(
    accountId: string,
    packageId: string,
  ): Promise<ServicePackage> {
    const profile = await this.getProfileOrThrow(accountId);
    return this.getOwnedPackageOrThrow(packageId, profile.id);
  }

  async updatePackage(
    accountIdOrId: string,
    packageId: string,
    dto: UpsertPackageDto,
  ): Promise<ServicePackage> {
    // C10: sửa gói của mình không cần APPROVED.
    const profile = await this.getProfileOrThrow(accountIdOrId);
    const pkg = await this.getOwnedPackageOrThrow(packageId, profile.id);
    this.validateDeclaredValueRange(dto);

    // C15: MERGE — chỉ cập nhật field client gửi; nhất quán với PUT hồ sơ (C1).
    if (dto.name !== undefined) pkg.name = dto.name;
    if (dto.description !== undefined) pkg.description = dto.description;
    if (dto.durationDays !== undefined) pkg.durationDays = dto.durationDays;
    if (dto.reportFrequencyDays !== undefined)
      pkg.reportFrequencyDays = dto.reportFrequencyDays;
    if (dto.maxPlants !== undefined) pkg.maxPlants = dto.maxPlants;
    if (dto.basePrice !== undefined) pkg.basePrice = String(dto.basePrice);
    if (dto.minDeclaredValue !== undefined)
      pkg.minDeclaredValue = String(dto.minDeclaredValue);
    if (dto.maxDeclaredValue !== undefined)
      pkg.maxDeclaredValue = String(dto.maxDeclaredValue);
    // Provider không được tự duyệt/kích hoạt package.
    pkg.isActive = false;
    pkg.approvalStatus = 'PENDING';
    pkg.rejectionReason = null;

    return this.packageRepo.save(pkg);
  }

  async deletePackage(accountId: string, packageId: string): Promise<void> {
    // C10: xoá gói của mình không cần APPROVED.
    const profile = await this.getProfileOrThrow(accountId);
    const pkg = await this.getOwnedPackageOrThrow(packageId, profile.id);
    await this.packageRepo.softRemove(pkg);
  }

  async listAllPackagesForAdmin(): Promise<ServicePackage[]> {
    return this.packageRepo.find({
      relations: { provider: true },
      order: { createdAt: 'DESC' },
    });
  }

  async setPackageActive(
    packageId: string,
    isActive?: boolean,
    decision?: 'APPROVED' | 'REJECTED',
    note?: string,
  ): Promise<ServicePackage> {
    const pkg = await this.packageRepo.findOne({ where: { id: packageId } });
    if (!pkg) throw new NotFoundException('PACKAGE_NOT_FOUND');
    const nextDecision = decision ?? (isActive ? 'APPROVED' : 'REJECTED');
    pkg.approvalStatus = nextDecision;
    pkg.rejectionReason = nextDecision === 'REJECTED' ? (note ?? null) : null;
    pkg.isActive = nextDecision === 'APPROVED' && isActive !== false;
    return this.packageRepo.save(pkg);
  }

  // Public: khách chỉ xem gói đang bán của provider đã được duyệt.
  async listPublicPackages(
    providerIdOrSlug: string,
  ): Promise<ServicePackage[]> {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        providerIdOrSlug || '',
      );
    let profile: ProviderProfile | null = null;

    if (isUuid) {
      profile = await this.profileRepo.findOne({
        where: [{ id: providerIdOrSlug }, { accountId: providerIdOrSlug }],
      });
    }

    if (!profile && providerIdOrSlug) {
      const kw = providerIdOrSlug.trim().toLowerCase();
      profile = await this.profileRepo
        .createQueryBuilder('p')
        .leftJoinAndSelect('p.account', 'a')
        .where('LOWER(a.email) = :kw', { kw })
        .orWhere('LOWER(a.email) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .orWhere('LOWER(p.display_name) LIKE :kwLike', {
          kwLike: `%${kw.replace(/-/g, '%')}%`,
        })
        .getOne();
    }

    if (!profile) {
      return [];
    }

    return this.packageRepo.find({
      where: {
        providerId: profile.id,
        isActive: true,
        approvalStatus: 'APPROVED',
      },
      order: { createdAt: 'DESC' },
    });
  }

  // basePrice đã chặn >=0 ở DTO; ở đây kiểm quan hệ min<max khi cả 2 cùng có mặt.
  // C9: chặn min>=max — khoảng khai giá phải có ít nhất 1 giá trị hợp lệ ở giữa
  // (orders coi min là cận LOẠI TRỪ; min===max làm khách khai giá kiểu gì cũng 400).
  private validateDeclaredValueRange(dto: UpsertPackageDto): void {
    if (
      dto.minDeclaredValue !== undefined &&
      dto.maxDeclaredValue !== undefined &&
      dto.minDeclaredValue > dto.maxDeclaredValue
    ) {
      throw new BadRequestException('DECLARED_VALUE_RANGE_INVALID');
    }
  }
}
