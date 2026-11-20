import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { assertGpsPair } from '../common/gps';
import {
  mapIdentityUniqueViolation,
  normalizePhone,
  sha256Hex,
} from '../common/identity';
import { Account } from '../accounts/entities/account.entity';
import { toAccountSummary } from '../accounts/account.mapper';
import { CryptoService } from '../crypto/crypto.service';
import { CustomerProfile } from './entities/customer-profile.entity';
import { UpsertCustomerProfileDto } from './dto/upsert-customer-profile.dto';
import { VerifyCustomerDto } from './dto/verify-customer.dto';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(CustomerProfile)
    private readonly profileRepo: Repository<CustomerProfile>,
    @InjectRepository(Account)
    private readonly accountRepo: Repository<Account>,
    private readonly crypto: CryptoService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Hồ sơ khách của account — CHƯA có thì tạo hồ sơ rỗng (NOT_SUBMITTED).
   * Đăng ký thường/Google chỉ tạo ACCOUNT; hồ sơ sinh ở lần đầu khách dùng tới
   * (GET/PUT /customers/me/profile, eKYC). Ngoài account_id, mọi cột đều nullable/default.
   */
  async getOrCreateProfile(
    accountId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<CustomerProfile> {
    const repo = manager.getRepository(CustomerProfile);
    const existing = await repo.findOne({ where: { accountId } });
    if (existing) {
      return existing;
    }
    await repo
      .createQueryBuilder()
      .insert()
      .into(CustomerProfile)
      .values({ accountId, verificationStatus: 'NOT_SUBMITTED' })
      .orIgnore()
      .execute();
    return repo.findOneOrFail({ where: { accountId } });
  }

  // GET /customers/me/profile — bản cho chủ hồ sơ: SĐT đã giải mã + thông tin cơ bản (không lưu CCCD/ảnh).
  async getMyProfile(accountId: string) {
    const profile = await this.getOrCreateProfile(accountId);
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    return this.toOwnerView(profile, account);
  }

  // C2: MERGE — chỉ cập nhật field client GỬI (!== undefined); field không gửi giữ nguyên.
  async updateMyProfile(accountId: string, dto: UpsertCustomerProfileDto) {
    assertGpsPair(dto.gpsLat, dto.gpsLng);

    try {
      // SĐT/Họ tên (bảng accounts) + hồ sơ ghi cùng 1 transaction: lỗi 1 bên thì không bên nào đổi.
      await this.dataSource.transaction(async (manager) => {
        const profile = await this.getOrCreateProfile(accountId, manager);
        const account = await manager.findOne(Account, {
          where: { id: accountId },
        });

        // Đã duyệt → khóa ngày sinh & quê quán (không cho tự ý đổi sau khi đã duyệt).
        const identityChangedAfterApproval =
          (dto.dateOfBirth !== undefined &&
            dto.dateOfBirth !== profile.dateOfBirth) ||
          (dto.placeOfOrigin !== undefined &&
            dto.placeOfOrigin !== profile.placeOfOrigin);
        if (
          identityChangedAfterApproval &&
          profile.verificationStatus === 'APPROVED'
        ) {
          throw new BadRequestException('IDENTITY_LOCKED_AFTER_APPROVAL');
        }

        if (dto.dateOfBirth !== undefined)
          profile.dateOfBirth = dto.dateOfBirth || null;
        if (dto.placeOfOrigin !== undefined)
          profile.placeOfOrigin = dto.placeOfOrigin || null;
        if (dto.address !== undefined) profile.address = dto.address;
        if (dto.defaultPickupAddress !== undefined)
          profile.defaultPickupAddress = dto.defaultPickupAddress;
        if (dto.gpsLat !== undefined) profile.gpsLat = String(dto.gpsLat);
        if (dto.gpsLng !== undefined) profile.gpsLng = String(dto.gpsLng);

        // Tài khoản nhận tiền hoàn: gửi chuỗi rỗng (sau trim) = xoá trường đó.
        if (dto.bankName !== undefined) profile.bankName = dto.bankName || null;
        if (dto.bankAccount !== undefined)
          profile.bankAccount = dto.bankAccount || null;
        if (dto.bankHolder !== undefined)
          profile.bankHolder = dto.bankHolder || null;

        const accountPatch: Partial<Account> = {};
        if (dto.fullName !== undefined && dto.fullName.trim()) {
          accountPatch.fullName = dto.fullName.trim();
        }

        if (dto.phone !== undefined) {
          const normalized = normalizePhone(dto.phone);
          const phoneHash = sha256Hex(normalized);
          const duplicate = await manager.findOne(Account, {
            where: { phoneHash },
          });
          if (duplicate && duplicate.id !== accountId) {
            throw new ConflictException('PHONE_EXISTS');
          }
          accountPatch.phone = this.crypto.encrypt(normalized);
          accountPatch.phoneHash = phoneHash;
        }

        const effectiveFullName = (
          accountPatch.fullName ??
          account?.fullName ??
          ''
        ).trim();
        const effectivePhone = accountPatch.phone ?? account?.phone ?? null;
        const isIdentityComplete = Boolean(
          effectiveFullName &&
            effectivePhone &&
            profile.address?.trim() &&
            profile.dateOfBirth?.trim() &&
            profile.placeOfOrigin?.trim(),
        );

        if (
          isIdentityComplete &&
          (profile.verificationStatus === 'NOT_SUBMITTED' ||
            profile.verificationStatus === 'REJECTED')
        ) {
          profile.verificationStatus = 'PENDING';
          profile.verificationNote = null;
        }

        if (Object.keys(accountPatch).length > 0) {
          await manager.update(Account, { id: accountId }, accountPatch);
        }

        await manager.save(profile);
      });
    } catch (err) {
      throw mapIdentityUniqueViolation(err);
    }

    return this.getMyProfile(accountId);
  }

  async listForAdmin() {
    const profiles = await this.profileRepo.find({
      relations: { account: true },
      order: { createdAt: 'DESC' },
    });
    return profiles.map((profile) => this.toAdminView(profile));
  }

  async getForAdmin(customerId: string) {
    const profile = await this.profileRepo.findOne({
      where: { id: customerId },
      relations: { account: true },
    });
    if (!profile) throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    return this.toAdminView(profile);
  }

  async verifyForAdmin(customerId: string, dto: VerifyCustomerDto) {
    const profile = await this.profileRepo.findOne({
      where: { id: customerId },
      relations: { account: true },
    });
    if (!profile) throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    if (
      dto.decision === 'APPROVED' &&
      (!profile.account?.fullName ||
        !profile.account?.phone ||
        !profile.address ||
        !profile.dateOfBirth ||
        !profile.placeOfOrigin)
    ) {
      throw new ConflictException('CUSTOMER_IDENTITY_DOCUMENTS_REQUIRED');
    }
    profile.verificationStatus = dto.decision;
    profile.verificationNote = dto.note?.trim() || null;

    // Đồng bộ account.status giống Provider: APPROVED → ACTIVE, REJECTED → PENDING.
    if (profile.account) {
      profile.account.status =
        dto.decision === 'APPROVED' ? 'ACTIVE' : 'PENDING';
      await this.accountRepo.save(profile.account);
    }

    return this.toAdminView(await this.profileRepo.save(profile));
  }

  // Bản cho chủ hồ sơ: giải mã SĐT, bỏ lostDisputeCount nội bộ.
  private toOwnerView(profile: CustomerProfile, account: Account | null) {
    const {
      account: _account,
      lostDisputeCount: _lostDisputeCount,
      ...rest
    } = profile;
    return {
      ...rest,
      fullName: account?.fullName ?? null,
      email: account?.email ?? null,
      phone: account?.phone ? this.crypto.decrypt(account.phone) : null,
    };
  }

  // Admin thấy bản giải mã SĐT; account qua toAccountSummary.
  private toAdminView(profile: CustomerProfile) {
    const { account, ...rest } = profile;
    const summary = account ? toAccountSummary(account, this.crypto) : null;
    return {
      ...rest,
      account: summary,
      fullName: summary?.fullName ?? null,
      email: summary?.email ?? null,
      phone: summary?.phone ?? null,
    };
  }
}
