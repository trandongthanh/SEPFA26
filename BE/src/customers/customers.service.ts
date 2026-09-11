import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { assertGpsPair } from '../common/gps';
import { Account } from '../accounts/entities/account.entity';
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
  ) { }

  // Profile luôn được auto-tạo trong transaction register — không tìm thấy là dữ liệu bất thường.
  async getMyProfile(accountId: string) {
    const profile = await this.profileRepo.findOne({ where: { accountId } });
    if (!profile) {
      throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    }
    const account = await this.accountRepo.findOne({ where: { id: accountId } });
    return {
      ...profile,
      phone: account?.phone ? this.crypto.decrypt(account.phone) : null,
      cccdNumber: profile.cccdNumber ? this.crypto.decrypt(profile.cccdNumber) : null,
    };
  }

  // C2: MERGE — chỉ cập nhật field client GỬI (!== undefined); field không gửi giữ nguyên.
  // GPS là tiền đề tính phí ship: đổi mỗi địa chỉ KHÔNG được xoá mất GPS đã ghim
  // (trước đây full-replace làm mất GPS → khách không đặt được đơn: CUSTOMER_GPS_REQUIRED).
  async updateMyProfile(
    accountId: string,
    dto: UpsertCustomerProfileDto,
  ) {
    assertGpsPair(dto.gpsLat, dto.gpsLng);
    const profile = await this.getMyProfile(accountId);

    // Đã duyệt → khóa toàn bộ giấy tờ định danh, không cho sửa.
    const identityFieldsSent = dto.cccdNumber !== undefined
      || dto.cccdFrontUrl !== undefined
      || dto.cccdBackUrl !== undefined
      || dto.selfieWithIdUrl !== undefined;

    if (identityFieldsSent && profile.verificationStatus === 'APPROVED') {
      throw new BadRequestException(
        'IDENTITY_LOCKED_AFTER_APPROVAL',
      );
    }

    if (dto.address !== undefined) profile.address = dto.address;
    if (dto.defaultPickupAddress !== undefined)
      profile.defaultPickupAddress = dto.defaultPickupAddress;
    if (dto.gpsLat !== undefined) profile.gpsLat = String(dto.gpsLat);
    if (dto.gpsLng !== undefined) profile.gpsLng = String(dto.gpsLng);
    if (dto.cccdFrontUrl !== undefined) profile.cccdFrontUrl = dto.cccdFrontUrl;
    if (dto.cccdBackUrl !== undefined) profile.cccdBackUrl = dto.cccdBackUrl;
    if (dto.selfieWithIdUrl !== undefined) profile.selfieWithIdUrl = dto.selfieWithIdUrl;

    // Mã hóa AES + hash SHA-256 để check unique (giống SĐT).
    if (dto.cccdNumber !== undefined) {
      const cccdNumberHash = createHash('sha256').update(dto.cccdNumber).digest('hex');
      const duplicate = await this.profileRepo.findOne({ where: { cccdNumberHash } });
      if (duplicate && duplicate.accountId !== accountId) {
        throw new ConflictException('CCCD_NUMBER_EXISTS');
      }
      profile.cccdNumber = this.crypto.encrypt(dto.cccdNumber);
      profile.cccdNumberHash = cccdNumberHash;
    }

    if (dto.phone !== undefined) {
      const normalized = this.normalizePhone(dto.phone);
      const phoneHash = createHash('sha256').update(normalized).digest('hex');
      const duplicate = await this.accountRepo.findOne({ where: { phoneHash } });
      if (duplicate && duplicate.id !== accountId) throw new ConflictException('PHONE_EXISTS');
      await this.accountRepo.update(accountId, { phone: this.crypto.encrypt(normalized), phoneHash });
    }

    const saved = await this.profileRepo.save(profile);
    return this.getMyProfile(saved.accountId);
  }

  async listForAdmin() {
    const profiles = await this.profileRepo.find({ relations: { account: true }, order: { createdAt: 'DESC' } });
    return profiles.map((profile) => ({
      ...profile,
      phone: profile.account.phone ? this.crypto.decrypt(profile.account.phone) : null,
      cccdNumber: profile.cccdNumber ? this.crypto.decrypt(profile.cccdNumber) : null,
    }));
  }

  async getForAdmin(customerId: string) {
    const profile = await this.profileRepo.findOne({ where: { id: customerId }, relations: { account: true } });
    if (!profile) throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    return {
      ...profile,
      phone: profile.account.phone ? this.crypto.decrypt(profile.account.phone) : null,
      cccdNumber: profile.cccdNumber ? this.crypto.decrypt(profile.cccdNumber) : null,
    };
  }

  async verifyForAdmin(customerId: string, dto: VerifyCustomerDto) {
    const profile = await this.profileRepo.findOne({
      where: { id: customerId },
      relations: { account: true },
    });
    if (!profile) throw new NotFoundException('CUSTOMER_PROFILE_NOT_FOUND');
    if (dto.decision === 'APPROVED' && (!profile.cccdFrontUrl || !profile.cccdBackUrl || !profile.selfieWithIdUrl || !profile.cccdNumber)) {
      throw new ConflictException('CUSTOMER_IDENTITY_DOCUMENTS_REQUIRED');
    }
    profile.verificationStatus = dto.decision;
    profile.verificationNote = dto.note?.trim() || null;

    // Đồng bộ account.status giống Provider: APPROVED → ACTIVE, REJECTED → PENDING.
    if (profile.account) {
      profile.account.status = dto.decision === 'APPROVED' ? 'ACTIVE' : 'PENDING';
      await this.accountRepo.save(profile.account);
    }

    return this.profileRepo.save(profile);
  }

  private normalizePhone(phone: string) {
    return phone.replace(/[\s.()-]/g, '').replace(/^\+84/, '0').replace(/^84/, '0');
  }
}
