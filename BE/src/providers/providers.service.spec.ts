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
const CCCD = '001234567890';
const PHONE = '0909123456';

// Lỗi Postgres unique_violation giả (giống lỗi driver pg ném ra).
const pgUnique = (column: string) =>
  Object.assign(new Error('duplicate key'), {
    code: '23505',
    detail: `Key (${column})=(x) already exists.`,
  });

describe('ProvidersService — SĐT + số CCCD của provider', () => {
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
      cccdFrontUrl: 'https://img/front.jpg',
      cccdBackUrl: 'https://img/back.jpg',
      selfieUrl: 'https://img/selfie.jpg',
      businessLicenseUrl: null,
      cccdNumber: null,
      cccdNumberHash: null,
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
    it('tạo hồ sơ kèm SĐT + CCCD: DB lưu ciphertext + hash, response trả bản giải mã, không lộ hash', async () => {
      const res = await upsert({
        providerType: 'NURSERY',
        displayName: 'Vườn Lan A',
        phone: '+84 909 123 456',
        cccdNumber: CCCD,
      });

      expect(stored!.cccdNumber).not.toBe(CCCD);
      expect(crypto.decrypt(stored!.cccdNumber!)).toBe(CCCD);
      expect(stored!.cccdNumberHash).toBe(sha256Hex(CCCD));
      expect(stored!.verificationStatus).toBe('PENDING');
      // SĐT chuẩn hoá trước khi mã hoá/băm → khớp hash của "0909123456".
      expect(account.phoneHash).toBe(sha256Hex(PHONE));
      expect(crypto.decrypt(account.phone!)).toBe(PHONE);

      expect(res.cccdNumber).toBe(CCCD);
      expect(res.phone).toBe(PHONE);
      expect(res.account?.phone).toBe(PHONE);
      expect(res).not.toHaveProperty('cccdNumberHash');
      expect(JSON.stringify(res)).not.toContain(sha256Hex(CCCD));
      expect(JSON.stringify(res)).not.toContain('bcrypt-hash');
    });

    it('400 PROVIDER_PROFILE_FIELDS_REQUIRED khi tạo lần đầu thiếu providerType/displayName — không ghi gì', async () => {
      await expect(upsert({ phone: PHONE })).rejects.toThrow(
        new BadRequestException('PROVIDER_PROFILE_FIELDS_REQUIRED'),
      );
      expect(manager.save).not.toHaveBeenCalled();
      expect(manager.update).not.toHaveBeenCalled();
    });

    it('409 CCCD_NUMBER_EXISTS khi CCCD đã thuộc vườn khác — không ghi gì', async () => {
      stored = makeProfile();
      otherProfiles = [
        makeProfile({
          id: 'other',
          accountId: OTHER_ACCOUNT_ID,
          cccdNumberHash: sha256Hex(CCCD),
        }),
      ];
      await expect(upsert({ cccdNumber: CCCD })).rejects.toThrow(
        new ConflictException('CCCD_NUMBER_EXISTS'),
      );
      expect(manager.save).not.toHaveBeenCalled();
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

    it('23505 cccd_number_hash ném từ save (khe đua) → 409 CCCD_NUMBER_EXISTS', async () => {
      stored = makeProfile();
      manager.save.mockRejectedValueOnce(pgUnique('cccd_number_hash'));
      await expect(upsert({ cccdNumber: CCCD })).rejects.toThrow(
        new ConflictException('CCCD_NUMBER_EXISTS'),
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

    describe('luật sau duyệt (APPROVED)', () => {
      it('đổi số CCCD → về PENDING (duyệt lại)', async () => {
        stored = makeProfile({
          verificationStatus: 'APPROVED',
          cccdNumber: crypto.encrypt('009999999999'),
          cccdNumberHash: sha256Hex('009999999999'),
        });
        const res = await upsert({ cccdNumber: CCCD });
        expect(res.verificationStatus).toBe('PENDING');
      });

      it('khai CCCD LẦN ĐẦU (null → số) → cũng về PENDING', async () => {
        stored = makeProfile({ verificationStatus: 'APPROVED' });
        const res = await upsert({ cccdNumber: CCCD });
        expect(res.verificationStatus).toBe('PENDING');
      });

      it('gửi lại đúng số CCCD đang có → giữ APPROVED, không 409 với chính mình', async () => {
        stored = makeProfile({
          verificationStatus: 'APPROVED',
          cccdNumber: crypto.encrypt(CCCD),
          cccdNumberHash: sha256Hex(CCCD),
        });
        const res = await upsert({ cccdNumber: CCCD });
        expect(res.verificationStatus).toBe('APPROVED');
      });

      // Khoá luật đã chốt: SĐT KHÔNG thuộc bộ KYC — đừng thêm luật "đổi SĐT → PENDING".
      it('đổi SĐT → VẪN APPROVED', async () => {
        stored = makeProfile({ verificationStatus: 'APPROVED' });
        Object.assign(account, encryptedPhone('0911222333'));
        const res = await upsert({ phone: PHONE });
        expect(res.verificationStatus).toBe('APPROVED');
        expect(res.phone).toBe(PHONE);
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
        cccdNumber: crypto.encrypt(CCCD),
        cccdNumberHash: sha256Hex(CCCD),
        account: Object.assign(account, encryptedPhone(PHONE)),
      });

    it.each([
      ['thiếu số CCCD', { cccdNumber: null }],
      ['thiếu selfie', { selfieUrl: null }],
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

    it('verify APPROVED đủ bộ → APPROVED + account ACTIVE, trả view (không hash/passwordHash)', async () => {
      profileRepo.findOne.mockResolvedValueOnce(complete());
      const res = await service.verifyProvider(PROFILE_ID, {
        decision: 'APPROVED',
      });
      expect(res.verificationStatus).toBe('APPROVED');
      expect(accountRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'ACTIVE' }),
      );
      expect(res.cccdNumber).toBe(CCCD);
      expect(res.phone).toBe(PHONE);
      expect(res).not.toHaveProperty('cccdNumberHash');
      expect(JSON.stringify(res)).not.toContain('bcrypt-hash');
    });

    it('REJECTED không cần đủ giấy tờ', async () => {
      profileRepo.findOne.mockResolvedValueOnce(
        makeProfile({ account, selfieUrl: null }),
      );
      const res = await service.verifyProvider(PROFILE_ID, {
        decision: 'REJECTED',
        note: 'Thiếu selfie',
      });
      expect(res.verificationStatus).toBe('REJECTED');
    });

    it('danh sách: canVerify chỉ true khi PENDING + đủ bộ; không lộ hash', async () => {
      const ok = complete();
      const missing = makeProfile({ id: 'p2', account });
      missing.cccdNumber = null;
      profileRepo.find.mockResolvedValueOnce([ok, missing]);
      const list = await service.listAllForAdmin();
      expect(list.map((p) => p.canVerify)).toEqual([true, false]);
      expect(list[0].cccdNumber).toBe(CCCD);
      for (const p of list) expect(p).not.toHaveProperty('cccdNumberHash');
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

    // DB giả: có Vườn A đã duyệt. Tìm theo accountId chỉ ra hồ sơ khớp đúng account đó;
    // query KHÔNG lọc theo người gọi (như fallback cũ) sẽ trả về Vườn A.
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
          return Promise.resolve(vuonA); // query không gắn người gọi → "trúng" vườn khác
        },
      );
    };

    it('vườn đã duyệt → gói gắn đúng hồ sơ của mình, PENDING, chưa mở bán', async () => {
      dbWith(makeProfile({ verificationStatus: 'APPROVED' }));
      const pkg = await service.createPackage(ACCOUNT_ID, packageDto);
      expect(pkg.providerId).toBe(PROFILE_ID);
      expect(pkg).toMatchObject({ approvalStatus: 'PENDING', isActive: false });
      // Chỉ 1 lần tìm hồ sơ, và đúng theo accountId trong token.
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
