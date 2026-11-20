import { BadRequestException, ConflictException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { DataSource, EntityManager, Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { normalizePhone, sha256Hex } from '../common/identity';
import { CryptoService } from '../crypto/crypto.service';
import { CustomersService } from './customers.service';
import { CustomerProfile } from './entities/customer-profile.entity';
import type { UpsertCustomerProfileDto } from './dto/upsert-customer-profile.dto';

const ACCOUNT_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_ACCOUNT_ID = '22222222-2222-4222-8222-222222222222';
const PROFILE_ID = '33333333-3333-4333-8333-333333333333';
const PHONE = '0909123456';
const DOB = '15/05/1992';
const ORIGIN = 'Quận 1, TP.HCM';
const ADDRESS = '25 Lê Lợi, Quận 1, TP.HCM';

describe('CustomersService — trạng thái NOT_SUBMITTED và nộp lại hồ sơ', () => {
  const crypto = new CryptoService({
    get: () => '0'.repeat(64),
  } as unknown as ConfigService);

  let service: CustomersService;
  let stored: CustomerProfile | null;
  let account: Account;
  let otherAccounts: Account[];
  let manager: {
    getRepository: jest.Mock;
    findOne: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
  };
  let profileRepo: {
    findOne: jest.Mock;
    findOneOrFail: jest.Mock;
    createQueryBuilder: jest.Mock;
    find: jest.Mock;
    save: jest.Mock;
  };
  let accountRepo: { findOne: jest.Mock; save: jest.Mock };
  let dataSource: { manager: EntityManager; transaction: jest.Mock };

  const makeProfile = (patch: Partial<CustomerProfile> = {}) =>
    Object.assign(new CustomerProfile(), {
      id: PROFILE_ID,
      accountId: ACCOUNT_ID,
      address: null,
      defaultPickupAddress: null,
      gpsLat: null,
      gpsLng: null,
      dateOfBirth: null,
      placeOfOrigin: null,
      verificationStatus: 'NOT_SUBMITTED',
      verificationNote: null,
      bankName: null,
      bankAccount: null,
      bankHolder: null,
      lostDisputeCount: 0,
      ...patch,
    });

  const encryptedPhone = (phone: string) => ({
    phone: crypto.encrypt(phone),
    phoneHash: sha256Hex(normalizePhone(phone)),
  });

  const updateMe = (dto: UpsertCustomerProfileDto) =>
    service.updateMyProfile(ACCOUNT_ID, dto);

  beforeEach(() => {
    stored = null;
    otherAccounts = [];
    account = Object.assign(new Account(), {
      id: ACCOUNT_ID,
      email: 'khach@example.com',
      fullName: 'Nguyễn Văn A',
      role: 'CUSTOMER',
      status: 'PENDING',
      passwordHash: 'bcrypt-hash',
      phone: null,
      phoneHash: null,
    });

    profileRepo = {
      findOne: jest.fn(({ where }: { where: Partial<CustomerProfile> }) => {
        if (
          stored &&
          Object.entries(where).every(
            ([k, v]) => (stored as unknown as Record<string, unknown>)[k] === v,
          )
        ) {
          return Promise.resolve(stored);
        }
        return Promise.resolve(null);
      }),
      findOneOrFail: jest.fn(() => {
        if (!stored) throw new Error('CustomerProfile not found');
        return Promise.resolve(stored);
      }),
      createQueryBuilder: jest.fn(() => {
        let pendingValues: Partial<CustomerProfile> = {};
        const qb = {
          insert: () => qb,
          into: () => qb,
          values: (vals: Partial<CustomerProfile>) => {
            pendingValues = vals;
            return qb;
          },
          orIgnore: () => qb,
          execute: jest.fn(() => {
            if (!stored) {
              stored = makeProfile({
                verificationStatus:
                  pendingValues.verificationStatus ?? 'NOT_SUBMITTED',
                ...pendingValues,
              });
            }
            return Promise.resolve();
          }),
        };
        return qb;
      }),
      find: jest.fn(),
      save: jest.fn((p: CustomerProfile) => {
        stored = p;
        return Promise.resolve(p);
      }),
    };

    accountRepo = {
      findOne: jest.fn(({ where }: { where: { id?: string } }) =>
        Promise.resolve(where.id === ACCOUNT_ID ? account : null),
      ),
      save: jest.fn((a: Account) => Promise.resolve(a)),
    };

    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === CustomerProfile) return profileRepo;
        return accountRepo;
      }),
      findOne: jest.fn(
        (entity: unknown, { where }: { where: Record<string, string> }) => {
          if (entity === Account) {
            const all = [account, ...otherAccounts];
            const hit = all.find((a) =>
              Object.entries(where).every(
                ([k, v]) => (a as unknown as Record<string, unknown>)[k] === v,
              ),
            );
            return Promise.resolve(hit ?? null);
          }
          return Promise.resolve(null);
        },
      ),
      save: jest.fn((profile: CustomerProfile) => {
        stored = profile;
        return Promise.resolve(profile);
      }),
      update: jest.fn(
        (_entity: unknown, where: { id?: string }, patch: Partial<Account>) => {
          if (where.id === ACCOUNT_ID) {
            Object.assign(account, patch);
          }
          return Promise.resolve({ affected: 1 });
        },
      ),
    };

    dataSource = {
      manager: manager as unknown as EntityManager,
      transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
        cb(manager as unknown as EntityManager),
      ),
    };

    service = new CustomersService(
      profileRepo as unknown as Repository<CustomerProfile>,
      accountRepo as unknown as Repository<Account>,
      crypto,
      dataSource as unknown as DataSource,
    );
  });

  it('GET /customers/me/profile lần đầu → tạo hồ sơ rỗng với verificationStatus = NOT_SUBMITTED', async () => {
    const res = await service.getMyProfile(ACCOUNT_ID);
    expect(res.verificationStatus).toBe('NOT_SUBMITTED');
    expect(stored?.verificationStatus).toBe('NOT_SUBMITTED');
  });

  it('cập nhật thiếu thông tin định danh (chỉ gửi address) → vẫn giữ NOT_SUBMITTED', async () => {
    const res = await updateMe({ address: ADDRESS });
    expect(res.address).toBe(ADDRESS);
    expect(res.verificationStatus).toBe('NOT_SUBMITTED');
  });

  it('điền đủ 5 trường (họ tên, SĐT, địa chỉ, ngày sinh, quê quán) → tự chuyển NOT_SUBMITTED → PENDING', async () => {
    const res = await updateMe({
      fullName: 'Nguyễn Văn B',
      phone: PHONE,
      address: ADDRESS,
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
    });
    expect(res.fullName).toBe('Nguyễn Văn B');
    expect(res.phone).toBe(PHONE);
    expect(res.verificationStatus).toBe('PENDING');
  });

  it('hồ sơ đang REJECTED cập nhật đủ 5 trường → chuyển về PENDING và xoá verificationNote', async () => {
    stored = makeProfile({
      verificationStatus: 'REJECTED',
      verificationNote: 'Địa chỉ chưa rõ',
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
    });
    Object.assign(account, encryptedPhone(PHONE));

    const res = await updateMe({ address: ADDRESS });
    expect(res.verificationStatus).toBe('PENDING');
    expect(res.verificationNote).toBeNull();
  });

  it('hồ sơ đang REJECTED nhưng vẫn thiếu trường định danh → giữ nguyên REJECTED', async () => {
    stored = makeProfile({
      verificationStatus: 'REJECTED',
      verificationNote: 'Thiếu ngày sinh & quê quán',
    });

    const res = await updateMe({ address: ADDRESS });
    expect(res.verificationStatus).toBe('REJECTED');
    expect(res.verificationNote).toBe('Thiếu ngày sinh & quê quán');
  });

  it('đã APPROVED: đổi dateOfBirth hoặc placeOfOrigin → 400 IDENTITY_LOCKED_AFTER_APPROVAL; đổi address → giữ APPROVED', async () => {
    stored = makeProfile({
      verificationStatus: 'APPROVED',
      address: ADDRESS,
      dateOfBirth: DOB,
      placeOfOrigin: ORIGIN,
    });
    Object.assign(account, encryptedPhone(PHONE));

    await expect(updateMe({ dateOfBirth: '01/01/1990' })).rejects.toThrow(
      new BadRequestException('IDENTITY_LOCKED_AFTER_APPROVAL'),
    );
    await expect(updateMe({ placeOfOrigin: 'Hà Nội' })).rejects.toThrow(
      new BadRequestException('IDENTITY_LOCKED_AFTER_APPROVAL'),
    );

    const updatedAddress = await updateMe({ address: '99 Hai Bà Trưng' });
    expect(updatedAddress.verificationStatus).toBe('APPROVED');
    expect(updatedAddress.address).toBe('99 Hai Bà Trưng');
  });

  it('409 PHONE_EXISTS khi SĐT đã thuộc account khác', async () => {
    otherAccounts = [
      Object.assign(new Account(), {
        id: OTHER_ACCOUNT_ID,
        ...encryptedPhone(PHONE),
      }),
    ];
    await expect(updateMe({ phone: '+84909123456' })).rejects.toThrow(
      new ConflictException('PHONE_EXISTS'),
    );
  });
});
