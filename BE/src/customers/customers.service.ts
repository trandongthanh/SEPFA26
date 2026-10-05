import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { createHash } from 'crypto';
import { assertGpsPair } from '../common/gps';
import { Account } from '../accounts/entities/account.entity';
import { toAccountSummary } from '../accounts/account.mapper';
import { CryptoService } from '../crypto/crypto.service';
import { CustomerProfile } from './entities/customer-profile.entity';
import { UpsertCustomerProfileDto } from './dto/upsert-customer-profile.dto';
import { VerifyCustomerDto } from './dto/verify-customer.dto';

// Postgres unique_violation — 2 khách khai trùng SĐT/CCCD chạy song song.
const PG_UNIQUE_VIOLATION = '23505';

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
   * Hồ sơ khách của account — CHƯA có thì tạo hồ sơ rỗng (PENDING).
   * Đăng ký thường/Google chỉ tạo ACCOUNT; hồ sơ sinh ở lần đầu khách dùng tới
   * (GET/PUT /customers/me/profile, eKYC). Ngoài account_id, mọi cột đều nullable/default.
   * INSERT ... ON CONFLICT DO NOTHING: 2 request đầu tiên chạy song song vẫn ra đúng 1 hồ sơ,
   * và không làm hỏng transaction của caller (khác với bắt lỗi 23505).
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
      .values({ accountId })
      .orIgnore()
      .execute();
    return repo.findOneOrFail({ where: { accountId } });
  }

  // GET /customers/me/profile — bản cho chủ hồ sơ: SĐT + CCCD đã giải mã.
  async getMyProfile(accountId: string) {
    const profile = await this.getOrCreateProfile(accountId);
    const account = await this.accountRepo.findOne({
      where: { id: accountId },
    });
    return this.toOwnerView(profile, account);
  }

  // C2: MERGE — chỉ cập nhật field client GỬI (!== undefined); field không gửi giữ nguyên.
  // GPS là tiền đề tính phí ship: đổi mỗi địa chỉ KHÔNG được xoá mất GPS đã ghim
  // (trước đây full-replace làm mất GPS → khách không đặt được đơn: CUSTOMER_GPS_REQUIRED).
  // Sửa ENTITY (cccdNumber còn mã hoá), không sửa bản đã giải mã của getMyProfile — trước
  // đây save bản giải mã → cột cccd_number bị ghi đè bằng số CCCD dạng rõ.
  async updateMyProfile(accountId: string, dto: UpsertCustomerProfileDto) {
    assertGpsPair(dto.gpsLat, dto.gpsLng);

    try {
      // SĐT (bảng accounts) + hồ sơ ghi cùng 1 transaction: lỗi 1 bên thì không bên nào đổi.
      await this.dataSource.transaction(async (manager) => {
        const profile = await this.getOrCreateProfile(accountId, manager);

        // Đã duyệt → khóa toàn bộ giấy tờ định danh, không cho sửa.
        const identityFieldsSent =
          dto.cccdNumber !== undefined ||
          dto.cccdFrontUrl !== undefined ||
          dto.cccdBackUrl !== undefined ||
          dto.selfieWithIdUrl !== undefined;
        if (identityFieldsSent && profile.verificationStatus === 'APPROVED') {
          throw new BadRequestException('IDENTITY_LOCKED_AFTER_APPROVAL');
        }

        if (dto.address !== undefined) profile.address = dto.address;
        if (dto.defaultPickupAddress !== undefined)
          profile.defaultPickupAddress = dto.defaultPickupAddress;
        if (dto.gpsLat !== undefined) profile.gpsLat = String(dto.gpsLat);
        if (dto.gpsLng !== undefined) profile.gpsLng = String(dto.gpsLng);
        if (dto.cccdFrontUrl !== undefined)
          profile.cccdFrontUrl = dto.cccdFrontUrl;
        if (dto.cccdBackUrl !== undefined)
          profile.cccdBackUrl = dto.cccdBackUrl;
        if (dto.selfieWithIdUrl !== undefined)
          profile.selfieWithIdUrl = dto.selfieWithIdUrl;

        // Mã hóa AES + hash SHA-256 để check unique (giống SĐT).
        if (dto.cccdNumber !== undefined) {
          const cccdNumberHash = createHash('sha256')
            .update(dto.cccdNumber)
            .digest('hex');
          const duplicate = await manager.findOne(CustomerProfile, {
            where: { cccdNumberHash },
          });
          if (duplicate && duplicate.accountId !== accountId) {
            throw new ConflictException('CCCD_NUMBER_EXISTS');
          }
          profile.cccdNumber = this.crypto.encrypt(dto.cccdNumber);
          profile.cccdNumberHash = cccdNumberHash;
        }

        if (dto.phone !== undefined) {
          const normalized = this.normalizePhone(dto.phone);
          const phoneHash = createHash('sha256')
            .update(normalized)
            .digest('hex');
          const duplicate = await manager.findOne(Account, {
            where: { phoneHash },
          });
          if (duplicate && duplicate.id !== accountId) {
            throw new ConflictException('PHONE_EXISTS');
          }
          await manager.update(
            Account,
            { id: accountId },
            { phone: this.crypto.encrypt(normalized), phoneHash },
          );
        }

        await manager.save(profile);
      });
    } catch (err) {
      // Check trùng ở trên có khe đua (2 khách cùng SĐT/CCCD song song) — UNIQUE là chốt cuối.
      throw this.mapUniqueViolation(err);
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
      (!profile.cccdFrontUrl ||
        !profile.cccdBackUrl ||
        !profile.selfieWithIdUrl ||
        !profile.cccdNumber)
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

  // Bản cho chủ hồ sơ: giải mã SĐT/CCCD, bỏ cccdNumberHash (hash không khoá — dò ngược được).
  private toOwnerView(profile: CustomerProfile, account: Account | null) {
    const { cccdNumberHash: _hash, account: _account, ...rest } = profile;
    return {
      ...rest,
      phone: account?.phone ? this.crypto.decrypt(account.phone) : null,
      cccdNumber: rest.cccdNumber ? this.crypto.decrypt(rest.cccdNumber) : null,
    };
  }

  // Admin thấy bản giải mã SĐT/CCCD; account qua toAccountSummary, bỏ cccdNumberHash.
  private toAdminView(profile: CustomerProfile) {
    const { account, cccdNumberHash: _hash, ...rest } = profile;
    const summary = account ? toAccountSummary(account, this.crypto) : null;
    return {
      ...rest,
      account: summary,
      phone: summary?.phone ?? null,
      cccdNumber: rest.cccdNumber ? this.crypto.decrypt(rest.cccdNumber) : null,
    };
  }

  private mapUniqueViolation(err: unknown): unknown {
    const pg = err as { code?: string; detail?: string };
    if (pg.code !== PG_UNIQUE_VIOLATION) {
      return err;
    }
    if (pg.detail?.includes('phone_hash')) {
      return new ConflictException('PHONE_EXISTS');
    }
    if (pg.detail?.includes('cccd_number_hash')) {
      return new ConflictException('CCCD_NUMBER_EXISTS');
    }
    return err;
  }

  private normalizePhone(phone: string) {
    return phone
      .replace(/[\s.()-]/g, '')
      .replace(/^\+84/, '0')
      .replace(/^84/, '0');
  }
}
