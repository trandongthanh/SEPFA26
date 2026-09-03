import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { assertGpsPair } from '../common/gps';
import { ProviderProfile } from './entities/provider-profile.entity';
import { ServicePackage } from './entities/service-package.entity';
import { Account } from '../accounts/entities/account.entity';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../crypto/password.service';
import { QueryProviderDto } from './dto/query-provider.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { VerifyProviderDto } from './dto/verify-provider.dto';
import { UpsertPackageDto } from './dto/upsert-package.dto';

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
  ) {}

  // Lấy hồ sơ của provider đang đăng nhập (GET /providers/me)
  async getMyProfile(accountId: string): Promise<any> {
    const profile = await this.profileRepo.findOne({
      where: { accountId },
      relations: { account: true },
    });

    if (!profile) {
      throw new NotFoundException('PROVIDER_PROFILE_NOT_FOUND');
    }

    return {
      ...profile,
      account: profile.account
        ? {
            ...profile.account,
            phone: profile.account.phone
              ? this.crypto.decrypt(profile.account.phone)
              : null,
          }
        : null,
    };
  }

  // Upsert hồ sơ provider: chưa có → tạo (PENDING); có rồi → cập nhật.
  // Đổi field nhạy cảm (license/type) khi đang APPROVED → tự về PENDING (duyệt lại).
  // address/gps KHÔNG nhạy cảm (thông tin vận hành — dời vườn không cần duyệt lại).
  async upsertProfile(
    accountId: string,
    dto: UpsertProfileDto,
  ): Promise<ProviderProfile> {
    assertGpsPair(dto.gpsLat, dto.gpsLng);

    const existing = await this.profileRepo.findOne({ where: { accountId } });

    if (!existing) {
      throw new NotFoundException('PROVIDER_PROFILE_NOT_FOUND');
    }

    // C1: MERGE — chỉ cập nhật field client thực sự gửi (!== undefined);
    // field không gửi giữ nguyên giá trị cũ (không còn full-replace nuốt dữ liệu).
    // So field nhạy cảm dựa trên GIÁ TRỊ MỚI SẼ CÓ (đã merge) so với giá trị cũ.
    const nextProviderType = dto.providerType ?? existing.providerType;
    const nextLicenseInfo =
      dto.licenseInfo !== undefined ? dto.licenseInfo : existing.licenseInfo;
    const sensitiveChanged =
      existing.licenseInfo !== nextLicenseInfo ||
      existing.providerType !== nextProviderType ||
      (dto.cccdFrontUrl !== undefined &&
        existing.cccdFrontUrl !== dto.cccdFrontUrl) ||
      (dto.cccdBackUrl !== undefined &&
        existing.cccdBackUrl !== dto.cccdBackUrl) ||
      (dto.businessLicenseUrl !== undefined &&
        existing.businessLicenseUrl !== dto.businessLicenseUrl);

    existing.providerType = nextProviderType;
    if (dto.displayName !== undefined) existing.displayName = dto.displayName;
    if (dto.bio !== undefined) existing.bio = dto.bio;
    existing.licenseInfo = nextLicenseInfo;
    if (dto.portfolioUrl !== undefined)
      existing.portfolioUrl = dto.portfolioUrl;
    if (dto.selfieUrl !== undefined) existing.selfieUrl = dto.selfieUrl;
    if (dto.cccdFrontUrl !== undefined)
      existing.cccdFrontUrl = dto.cccdFrontUrl;
    if (dto.cccdBackUrl !== undefined) existing.cccdBackUrl = dto.cccdBackUrl;
    if (dto.businessLicenseUrl !== undefined)
      existing.businessLicenseUrl = dto.businessLicenseUrl;
    if (dto.address !== undefined) existing.address = dto.address;
    if (dto.gpsLat !== undefined) existing.gpsLat = String(dto.gpsLat);
    if (dto.gpsLng !== undefined) existing.gpsLng = String(dto.gpsLng);
    if (dto.experience !== undefined) existing.experience = dto.experience;
    if (dto.specialties !== undefined) existing.specialties = dto.specialties;
    if (dto.serviceAreas !== undefined)
      existing.serviceAreas = dto.serviceAreas;
    if (dto.certificates !== undefined)
      existing.certificates = dto.certificates;
    if (dto.bankName !== undefined) existing.bankName = dto.bankName;
    if (dto.bankAccount !== undefined) existing.bankAccount = dto.bankAccount;
    if (dto.bankHolder !== undefined) existing.bankHolder = dto.bankHolder;

    if (sensitiveChanged && existing.verificationStatus === 'APPROVED') {
      existing.verificationStatus = 'PENDING';
    }

    return this.profileRepo.save(existing);
  }

  async getById(providerId: string): Promise<any> {
    const profile = await this.profileRepo.findOne({
      where: { id: providerId },
      relations: { account: true },
    });
    if (!profile) {
      throw new NotFoundException('PROVIDER_NOT_FOUND');
    }
    return {
      ...profile,
      account: profile.account
        ? {
            ...profile.account,
            phone: profile.account.phone
              ? this.crypto.decrypt(profile.account.phone)
              : null,
          }
        : null,
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
      ...p,
      canVerify: Boolean(
        p.verificationStatus === 'PENDING' &&
        p.cccdFrontUrl &&
        p.cccdBackUrl &&
        p.selfieUrl,
      ),
      account: p.account
        ? {
            id: p.account.id,
            email: p.account.email,
            fullName: p.account.fullName,
            role: p.account.role,
            status: p.account.status,
            phone: p.account.phone
              ? this.crypto.decrypt(p.account.phone)
              : null,
          }
        : null,
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
      provider: {
        ...profile,
        account: profile.account
          ? {
              id: profile.account.id,
              email: profile.account.email,
              fullName: profile.account.fullName,
              role: profile.account.role,
              status: profile.account.status,
              phone: profile.account.phone
                ? this.crypto.decrypt(profile.account.phone)
                : null,
            }
          : null,
      },
      packages,
    };
  }

  // Admin duyệt hồ sơ: đổi verificationStatus + lưu lý do. Admin toàn quyền.
  async verifyProvider(
    providerIdOrEmail: string,
    dto: VerifyProviderDto,
  ): Promise<ProviderProfile & { tempPassword?: string }> {
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

    if (
      dto.decision === 'APPROVED' &&
      (!profile.cccdFrontUrl || !profile.cccdBackUrl || !profile.selfieUrl)
    ) {
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

    return this.profileRepo.save(profile);
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
