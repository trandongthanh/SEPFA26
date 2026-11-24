import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { normalizePhone, sha256Hex } from '../common/identity';
import { CryptoService } from '../crypto/crypto.service';
import type { PasswordService } from '../crypto/password.service';
import { ProviderProfile } from './entities/provider-profile.entity';
import type { ServicePackage } from './entities/service-package.entity';
import { ProvidersService } from './providers.service';
import type { UpsertProfileDto } from './dto/upsert-profile.dto';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const PHONE = '0909123456';
const DOB = '15/08/1988';
const ORIGIN = 'TP. Bảo Lộc, Lâm Đồng';
const ADDRESS = '12 Nguyễn Văn Bảo, Gò Vấp, TP.HCM';

// Lỗi Postgres unique_violation giả (giống lỗi driver pg ném ra).
const pgUnique = (column: string) =>
  Object.assign(new Error('duplicate key'), {
    code: '23505',
    detail: `Key (${column})=(x) already exists.`,
  });

describe('ProvidersService — thông tin định danh hợp lệ (không lưu CCCD/ảnh)', () => {
  const crypto = new CryptoService({
    get: () => '0'.repeat(64),
  } as unknown as ConfigService);

  let service: ProvidersService;
  let stored: ProviderProfile | null;
  let account: Account;
  let otherProfiles: ProviderProfile[];
  let otherAccounts: Account[];
  let manager: {
    findOne: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let profileRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let accountRepo: { save: jest.Mock };
  let packageRepo: { create: jest.Mock; save: jest.Mock };
  let dataSource: { transaction: jest.Mock };

  const makeProfile = (patch: Partial<ProviderProfile> = {}) =>
    Object.assign(new ProviderProfile(), {
      id: PROFILE_ID,
      accountId: ACCOUNT_ID,
      providerType: 'NURSERY',
      displayName: 'Vườn Lan A',
      licenseInfo: null,
      verificationStatus: 'PENDING',
      verificationNote: null,
      address: ADDRESS,
      dateOfBirth: null,
      placeOfOrigin: null,
      businessLicenseUrl: null,
      ...patch,
    });

  const encryptedPhone = (phone: string) => ({
    phone: crypto.encrypt(phone),
    phoneHash: sha256Hex(normalizePhone(phone)),
  });

  const upsert = (dto: UpsertProfileDto) =>
    service.upsertProfile(ACCOUNT_ID, dto);

  beforeEach(() => {
    stored = null;
    otherProfiles = [];
    otherAccounts = [];
    account = Object.assign(new Account(), {
      id: ACCOUNT_ID,
      email: 'vuon@example.com',
      fullName: 'Nguyễn Văn Lan',
      role: 'PROVIDER',
      status: 'PENDING',
      passwordHash: 'bcrypt-hash',
      phone: null,
      phoneHash: null,
    });

    manager = {
      findOne: jest.fn(
        (entity: unknown, { where }: { where: Record<string, string> }) => {
          if (entity === ProviderProfile) {
            const all = stored ? [stored, ...otherProfiles] : otherProfiles;
            const hit = all.find((p) =>
              Object.entries(where).every(
                ([k, v]) => (p as unknown as Record<string, unknown>)[k] === v,
              ),
            );
            return Promise.resolve(hit ?? null);
          }
          if (entity === Account) {
            const hit = [account, ...otherAccounts].find(
              (a) => a.phoneHash === where.phoneHash,
            );
            return Promise.resolve(hit ?? null);
          }
          return Promise.resolve(null);
        },
      ),
      create: jest.fn((_entity: unknown, data: Partial<ProviderProfile>) =>
        Object.assign(new ProviderProfile(), data),
      ),
      save: jest.fn((profile: ProviderProfile) => {
        stored = profile;
        return Promise.resolve(profile);
      }),
      update: jest.fn(
        (_entity: unknown, _where: unknown, patch: Partial<Account>) => {
          Object.assign(account, patch);
          return Promise.resolve({ affected: 1 });
        },
      ),
    };
    dataSource = {
      transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
        cb(manager as unknown as EntityManager),
      ),
    };
    profileRepo = {
      findOne: jest.fn(() =>
        Promise.resolve(stored ? Object.assign(stored, { account }) : null),
      ),
      find: jest.fn(),
      save: jest.fn((p: ProviderProfile) => Promise.resolve(p)),
    };
    accountRepo = { save: jest.fn((a: Account) => Promise.resolve(a)) };
    packageRepo = {
      create: jest.fn((data: Partial<ServicePackage>) => data),
      save: jest.fn((pkg: Partial<ServicePackage>) =>
        Promise.resolve({ id: 'pkg-1', ...pkg }),
      ),
    };

    service = new ProvidersService(
      profileRepo as unknown as Repository<ProviderProfile>,
      packageRepo as unknown as Repository<ServicePackage>,
      accountRepo as unknown as Repository<Account>,
      crypto,
      {} as PasswordService,
      dataSource as unknown as DataSource,
    );
  });

  describe('PUT /providers/me/profile', () => {
    it('tạo hồ sơ kèm SĐT + Ngày sinh + Quê quán + Địa chỉ: DB mã hoá SĐT, response giải mã', async () => {
      const res = await upsert({
        providerType: 'NURSERY',
        displayName: 'Vườn Lan A',
        phone: '+84 909 123 456',
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        address: ADDRESS,
      });

      expect(stored!.verificationStatus).toBe('PENDING');
      expect(stored!.dateOfBirth).toBe(DOB);
      expect(stored!.placeOfOrigin).toBe(ORIGIN);
      expect(account.phoneHash).toBe(sha256Hex(PHONE));
      expect(crypto.decrypt(account.phone!)).toBe(PHONE);

      expect(res.phone).toBe(PHONE);
      expect(res.account?.phone).toBe(PHONE);
      expect(res.dateOfBirth).toBe(DOB);
      expect(res.placeOfOrigin).toBe(ORIGIN);
      expect(JSON.stringify(res)).not.toContain('bcrypt-hash');
    });

    it('400 PROVIDER_PROFILE_FIELDS_REQUIRED khi tạo lần đầu thiếu providerType/displayName — không ghi gì', async () => {
      await expect(upsert({ phone: PHONE })).rejects.toThrow(
        new BadRequestException('PROVIDER_PROFILE_FIELDS_REQUIRED'),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('409 PHONE_EXISTS khi SĐT đã thuộc account khác (kể cả viết kiểu +84)', async () => {
      stored = makeProfile();
      otherAccounts = [
        Object.assign(new Account(), {
          id: OTHER_ACCOUNT_ID,
          ...encryptedPhone(PHONE),
        }),
      ];
      await expect(upsert({ phone: '+84909123456' })).rejects.toThrow(
        new ConflictException('PHONE_EXISTS'),
      );
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('23505 phone_hash ném từ UPDATE accounts (khe đua) → 409 PHONE_EXISTS', async () => {
      stored = makeProfile();
      manager.update.mockRejectedValueOnce(pgUnique('phone_hash'));
      await expect(upsert({ phone: PHONE })).rejects.toThrow(
        new ConflictException('PHONE_EXISTS'),
      );
    });

    it('23505 account_id (2 PUT tạo song song) → chạy lại 1 lần như cập nhật', async () => {
      manager.save.mockRejectedValueOnce(pgUnique('account_id'));
      const res = await upsert({
        providerType: 'NURSERY',
        displayName: 'Vườn Lan A',
      });
      expect(dataSource.transaction).toHaveBeenCalledTimes(2);
      expect(res.displayName).toBe('Vườn Lan A');
    });

    describe('tài khoản ngân hàng — cho sửa, cấm xoá', () => {
      const BANK = {
        bankName: 'Vietcombank',
        bankAccount: '9876543210',
        bankHolder: 'NGUYEN VAN A',
      };

      it('gửi đủ bộ 3 + BIN → lưu cả bộ', async () => {
        stored = makeProfile();
        const res = await upsert({ ...BANK, bankBin: '970436' });
        expect(res).toMatchObject({ ...BANK, bankBin: '970436' });
      });

      it('gửi thiếu chủ tài khoản → 400 BANK_INFO_INCOMPLETE, không ghi', async () => {
        stored = makeProfile();
        await expect(
          upsert({ bankName: BANK.bankName, bankAccount: BANK.bankAccount }),
        ).rejects.toThrow(new BadRequestException('BANK_INFO_INCOMPLETE'));
        expect(manager.save).not.toHaveBeenCalled();
      });

      it('gửi rỗng để xoá → 400 BANK_INFO_CANNOT_BE_CLEARED, không ghi', async () => {
        stored = makeProfile({ ...BANK, bankBin: null });
        await expect(upsert({ ...BANK, bankAccount: '' })).rejects.toThrow(
          new BadRequestException('BANK_INFO_CANNOT_BE_CLEARED'),
        );
        expect(manager.save).not.toHaveBeenCalled();
      });
    });

    describe('luật sau duyệt (APPROVED)', () => {
      it('đổi Ngày sinh hoặc Quê quán hoặc GPKD → về PENDING (duyệt lại)', async () => {
        stored = makeProfile({
          verificationStatus: 'APPROVED',
          dateOfBirth: DOB,
          placeOfOrigin: ORIGIN,
        });
        const dobChanged = await upsert({ dateOfBirth: '01/01/1990' });
        expect(dobChanged.verificationStatus).toBe('PENDING');

        stored = makeProfile({
          verificationStatus: 'APPROVED',
          dateOfBirth: DOB,
          placeOfOrigin: ORIGIN,
        });
        const originChanged = await upsert({ placeOfOrigin: 'Hà Nội' });
        expect(originChanged.verificationStatus).toBe('PENDING');
      });

      it('gửi lại đúng Ngày sinh & Quê quán đang có → giữ APPROVED', async () => {
        stored = makeProfile({
          verificationStatus: 'APPROVED',
          dateOfBirth: DOB,
          placeOfOrigin: ORIGIN,
        });
        const res = await upsert({ dateOfBirth: DOB, placeOfOrigin: ORIGIN });
        expect(res.verificationStatus).toBe('APPROVED');
      });

      // Khoá luật đã chốt: SĐT & Địa chỉ KHÔNG thuộc bộ làm rớt về PENDING.
      it('đổi SĐT hoặc Địa chỉ → VẪN APPROVED', async () => {
        stored = makeProfile({ verificationStatus: 'APPROVED' });
        Object.assign(account, encryptedPhone('0911222333'));
        const res = await upsert({ phone: PHONE, address: '99 Hai Bà Trưng' });
        expect(res.verificationStatus).toBe('APPROVED');
        expect(res.phone).toBe(PHONE);
        expect(res.address).toBe('99 Hai Bà Trưng');
      });
    });

    describe('luật nộp lại sau khi bị từ chối (REJECTED)', () => {
      it('đang REJECTED mà sửa trường không nhạy cảm (Địa chỉ) → về PENDING và xoá verificationNote', async () => {
        stored = makeProfile({
          verificationStatus: 'REJECTED',
          verificationNote: 'Thiếu thông tin quê quán',
        });
        const res = await upsert({ address: '99 Hai Bà Trưng' });
        expect(res.verificationStatus).toBe('PENDING');
        expect(res.verificationNote).toBeNull();
        expect(res.address).toBe('99 Hai Bà Trưng');
      });

      it('đang REJECTED mà sửa trường nhạy cảm (Ngày sinh) → về PENDING và xoá verificationNote', async () => {
        stored = makeProfile({
          verificationStatus: 'REJECTED',
          verificationNote: 'Sai ngày sinh',
        });
        const res = await upsert({ dateOfBirth: '01/01/1990' });
        expect(res.verificationStatus).toBe('PENDING');
        expect(res.verificationNote).toBeNull();
        expect(res.dateOfBirth).toBe('01/01/1990');
      });
    });
  });

  describe('GET /providers/me', () => {
    it('404 PROVIDER_PROFILE_NOT_FOUND khi chưa có hồ sơ', async () => {
      await expect(service.getMyProfile(ACCOUNT_ID)).rejects.toThrow(
        new NotFoundException('PROVIDER_PROFILE_NOT_FOUND'),
      );
    });
  });

  describe('admin', () => {
    const complete = () =>
      makeProfile({
        address: ADDRESS,
        dateOfBirth: DOB,
        placeOfOrigin: ORIGIN,
        bankName: 'Vietcombank',
        bankAccount: '9876543210',
        bankHolder: 'NGUYEN VAN A',
        account: Object.assign(account, encryptedPhone(PHONE)),
      });

    it.each([
      ['thiếu Ngày sinh', { dateOfBirth: null }],
      ['thiếu Quê quán', { placeOfOrigin: null }],
      ['thiếu Địa chỉ', { address: null }],
    ])(
      'verify APPROVED %s → 400 PROVIDER_PROFILE_NOT_SUBMITTED',
      async (_case, patch) => {
        profileRepo.findOne.mockResolvedValueOnce(
          Object.assign(complete(), patch),
        );
        await expect(
          service.verifyProvider(PROFILE_ID, { decision: 'APPROVED' }),
        ).rejects.toThrow(
          new BadRequestException('PROVIDER_PROFILE_NOT_SUBMITTED'),
        );
      },
    );

    it('verify APPROVED thiếu SĐT → 400 PROVIDER_PROFILE_NOT_SUBMITTED', async () => {
      const profile = complete();
      profile.account.phone = null;
      profileRepo.findOne.mockResolvedValueOnce(profile);
      await expect(
        service.verifyProvider(PROFILE_ID, { decision: 'APPROVED' }),
      ).rejects.toThrow(
        new BadRequestException('PROVIDER_PROFILE_NOT_SUBMITTED'),
      );
    });

    it('verify APPROVED đủ bộ → APPROVED + account ACTIVE, trả view (không passwordHash)', async () => {
      profileRepo.findOne.mockResolvedValueOnce(complete());
      const res = await service.verifyProvider(PROFILE_ID, {
        decision: 'APPROVED',
      });
      expect(res.verificationStatus).toBe('APPROVED');
      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE' }),
      );
      expect(res.phone).toBe(PHONE);
      expect(res.dateOfBirth).toBe(DOB);
      expect(res.placeOfOrigin).toBe(ORIGIN);
      expect(JSON.stringify(res)).not.toContain('bcrypt-hash');
    });

    it('verify APPROVED đủ định danh nhưng thiếu ngân hàng → 400 PROVIDER_BANK_INFO_REQUIRED', async () => {
      profileRepo.findOne.mockResolvedValueOnce(
        Object.assign(complete(), { bankHolder: null }),
      );
      await expect(
        service.verifyProvider(PROFILE_ID, { decision: 'APPROVED' }),
      ).rejects.toThrow(new BadRequestException('PROVIDER_BANK_INFO_REQUIRED'));
      expect(accountRepo.save).not.toHaveBeenCalled();
    });

    it('REJECTED không cần đủ thông tin', async () => {
      profileRepo.findOne.mockResolvedValueOnce(
        makeProfile({ account, dateOfBirth: null }),
      );
      const res = await service.verifyProvider(PROFILE_ID, {
        decision: 'REJECTED',
        note: 'Thiếu thông tin ngày sinh',
      });
      expect(res.verificationStatus).toBe('REJECTED');
    });

    it('danh sách: canVerify chỉ true khi PENDING + đủ bộ + có ngân hàng', async () => {
      const ok = complete();
      const missing = makeProfile({ id: 'p2', account });
      const noBank = Object.assign(complete(), { id: 'p3', bankAccount: null });
      profileRepo.find.mockResolvedValueOnce([ok, missing, noBank]);
      const list = await service.listAllForAdmin();
      expect(list.map((p) => p.canVerify)).toEqual([true, false, false]);
    });
  });

  // B01: trước đây vườn chưa có hồ sơ → code lấy hồ sơ APPROVED mới nhất của VƯỜN KHÁC để gắn gói.
  describe('POST /providers/me/packages — gói chỉ gắn hồ sơ của chính người gọi', () => {
    const VUON_A_PROFILE_ID = '44444444-4444-4444-8444-444444444444';
    const packageDto = {
      name: 'Gói chăm Hồ Điệp 30 ngày',
      description: 'Tưới, bón, báo cáo 7 ngày/lần',
      durationDays: 30,
      reportFrequencyDays: 7,
      maxPlants: 5,
      basePrice: 200000,
      minDeclaredValue: 100000,
      maxDeclaredValue: 5000000,
    };

    const dbWith = (callerProfile: ProviderProfile | null) => {
      const vuonA = makeProfile({
        id: VUON_A_PROFILE_ID,
        accountId: OTHER_ACCOUNT_ID,
        verificationStatus: 'APPROVED',
      });
      profileRepo.findOne.mockImplementation(
        ({ where }: { where: Record<string, unknown> }) => {
          if (where?.accountId === ACCOUNT_ID) {
            return Promise.resolve(callerProfile);
          }
          if (where?.accountId === OTHER_ACCOUNT_ID) {
            return Promise.resolve(vuonA);
          }
          return Promise.resolve(vuonA);
        },
      );
    };

    it('vườn đã duyệt → gói gắn đúng hồ sơ của mình, PENDING, chưa mở bán', async () => {
      dbWith(makeProfile({ verificationStatus: 'APPROVED' }));
      const pkg = await service.createPackage(ACCOUNT_ID, packageDto);
      expect(pkg.providerId).toBe(PROFILE_ID);
      expect(pkg).toMatchObject({ approvalStatus: 'PENDING', isActive: false });
      expect(profileRepo.findOne).toHaveBeenCalledTimes(1);
      expect(profileRepo.findOne).toHaveBeenCalledWith({
        where: { accountId: ACCOUNT_ID },
      });
    });

    it('vườn CHƯA có hồ sơ (dù DB có vườn khác đã duyệt) → 404 PROFILE_NOT_FOUND, không tạo gói', async () => {
      dbWith(null);
      await expect(
        service.createPackage(ACCOUNT_ID, packageDto),
      ).rejects.toThrow(new NotFoundException('PROFILE_NOT_FOUND'));
      expect(packageRepo.save).not.toHaveBeenCalled();
      expect(profileRepo.findOne).toHaveBeenCalledTimes(1);
    });

    it.each(['PENDING', 'REJECTED'] as const)(
      'hồ sơ %s → 403 PROFILE_NOT_APPROVED, không tạo gói',
      async (status) => {
        dbWith(makeProfile({ verificationStatus: status }));
        await expect(
          service.createPackage(ACCOUNT_ID, packageDto),
        ).rejects.toThrow(new ForbiddenException('PROFILE_NOT_APPROVED'));
        expect(packageRepo.save).not.toHaveBeenCalled();
      },
    );

    it('khoảng giá khai sai (min > max) → 400 DECLARED_VALUE_RANGE_INVALID', async () => {
      dbWith(makeProfile({ verificationStatus: 'APPROVED' }));
      await expect(
        service.createPackage(ACCOUNT_ID, {
          ...packageDto,
          minDeclaredValue: 9000000,
        }),
      ).rejects.toThrow(
        new BadRequestException('DECLARED_VALUE_RANGE_INVALID'),
      );
      expect(packageRepo.save).not.toHaveBeenCalled();
    });
  });
});
