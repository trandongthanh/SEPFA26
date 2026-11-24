import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { FindOperator, type EntityManager, type Repository } from 'typeorm';
import { Account } from '../accounts/entities/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { CryptoService } from '../crypto/crypto.service';
import { PasswordService } from '../crypto/password.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { EkycRecord } from '../ekyc/entities/ekyc-record.entity';
import type { EkycService } from '../ekyc/ekyc.service';
import type { EmailOtpMail, MailService } from '../mail/mail.service';
import { AuthService } from './auth.service';
import { EmailOtp } from './entities/email-otp.entity';
import { PasswordResetToken } from './entities/password-reset-token.entity';
import { RefreshToken } from './entities/refresh-token.entity';
import type { GoogleIdTokenVerifier } from './google-id-token.verifier';
import { TokenService } from './token.service';

const ACCESS_SECRET = 'test-access-secret-0123456789abcdef0123';
const REFRESH_SECRET = 'test-refresh-secret-0123456789abcdef012';

function matchesWhere<T extends object>(
  row: T,
  where?: Record<string, unknown>,
): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    const val = (row as Record<string, unknown>)[key];
    if (cond instanceof FindOperator) {
      if (cond.type === 'isNull') return val === null || val === undefined;
      if (cond.type === 'moreThan') return (val as Date) > (cond.value as Date);
      if (cond.type === 'lessThan') return (val as Date) < (cond.value as Date);
    }
    return val === cond;
  });
}

describe('AuthService — OTP đăng ký, xác thực email, Google, quên mật khẩu & sessions', () => {
  let service: AuthService;
  let tokenService: TokenService;
  let passwordService: PasswordService;
  let crypto: CryptoService;

  let accountRows: Account[];
  let refreshRows: RefreshToken[];
  let resetTokenRows: PasswordResetToken[];
  let otpRows: EmailOtp[];
  let sentOtpMails: { kind: string; mail: EmailOtpMail }[];
  let sentGoogleMails: { to: string; password: string }[];

  let seq = 1;
  const nextUuid = () => {
    const n = (seq++).toString(16).padStart(12, '0');
    return `11111111-1111-4111-8111-${n}`;
  };

  function makeRepo<T extends { id?: string; createdAt?: Date }>(
    store: T[],
    Ctor: new () => T,
  ) {
    return {
      exists: jest.fn(({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(store.some((r) => matchesWhere(r, where))),
      ),
      findOne: jest.fn(
        ({
          where,
          order,
        }: {
          where: Record<string, unknown>;
          order?: Record<string, 'ASC' | 'DESC'>;
        }) => {
          let list = store.filter((r) => matchesWhere(r, where));
          if (order?.createdAt) {
            const dir = order.createdAt === 'DESC' ? -1 : 1;
            list = [...list].sort(
              (a, b) =>
                ((a.createdAt?.getTime() ?? 0) -
                  (b.createdAt?.getTime() ?? 0)) *
                dir,
            );
          }
          return Promise.resolve(list[0] ?? null);
        },
      ),
      find: jest.fn(
        ({
          where,
          order,
        }: {
          where: Record<string, unknown>;
          order?: Record<string, 'ASC' | 'DESC'>;
        }) => {
          let list = store.filter((r) => matchesWhere(r, where));
          if (order?.createdAt) {
            const dir = order.createdAt === 'DESC' ? -1 : 1;
            list = [...list].sort(
              (a, b) =>
                ((a.createdAt?.getTime() ?? 0) -
                  (b.createdAt?.getTime() ?? 0)) *
                dir,
            );
          }
          return Promise.resolve(list);
        },
      ),
      create: jest.fn((data: Partial<T>) =>
        Object.assign(new Ctor(), {
          id: nextUuid(),
          createdAt: new Date(),
          ...data,
        }),
      ),
      save: jest.fn((entity: T) => {
        const idx = store.findIndex((r) => r.id === entity.id);
        if (idx >= 0) {
          store[idx] = entity;
        } else {
          if (!entity.id) entity.id = nextUuid();
          if (!entity.createdAt) entity.createdAt = new Date();
          store.push(entity);
        }
        return Promise.resolve(entity);
      }),
      update: jest.fn(
        (where: Record<string, unknown>, patch: Partial<T>) => {
          let affected = 0;
          for (const row of store) {
            if (matchesWhere(row, where)) {
              Object.assign(row, patch);
              affected++;
            }
          }
          return Promise.resolve({ affected });
        },
      ),
      delete: jest.fn((where: Record<string, unknown>) => {
        let affected = 0;
        for (let i = store.length - 1; i >= 0; i--) {
          if (matchesWhere(store[i], where)) {
            store.splice(i, 1);
            affected++;
          }
        }
        return Promise.resolve({ affected });
      }),
    };
  }

  let googleProfile: { email: string; fullName: string };

  beforeEach(() => {
    seq = 1;
    accountRows = [];
    refreshRows = [];
    resetTokenRows = [];
    otpRows = [];
    sentOtpMails = [];
    sentGoogleMails = [];
    googleProfile = { email: 'hoa@gmail.com', fullName: 'Trần Thị Hoa' };

    const config = {
      get: (key: string, def?: unknown) => {
        const map: Record<string, unknown> = {
          JWT_ACCESS_SECRET: ACCESS_SECRET,
          JWT_ACCESS_EXPIRES: '15m',
          JWT_REFRESH_SECRET: REFRESH_SECRET,
          JWT_REFRESH_EXPIRES: '7d',
          BCRYPT_SALT_ROUNDS: 4,
          DATA_ENCRYPTION_KEY: '0'.repeat(64),
        };
        return map[key] ?? def;
      },
    } as unknown as ConfigService;

    tokenService = new TokenService(new JwtService({}), config);
    passwordService = new PasswordService(config);
    crypto = new CryptoService(config);

    const accountsRepo = makeRepo(accountRows, Account);
    const refreshRepo = makeRepo(refreshRows, RefreshToken);
    const resetRepo = makeRepo(resetTokenRows, PasswordResetToken);
    const otpRepo = makeRepo(otpRows, EmailOtp);
    const customerRepo = makeRepo([], CustomerProfile);
    const ekycRepo = makeRepo([], EkycRecord);

    const manager = {
      getRepository: (entity: unknown) => {
        if (entity === Account) return accountsRepo;
        if (entity === RefreshToken) return refreshRepo;
        if (entity === PasswordResetToken) return resetRepo;
        if (entity === EmailOtp) return otpRepo;
        if (entity === CustomerProfile) return customerRepo;
        if (entity === EkycRecord) return ekycRepo;
        throw new Error('Unknown repo');
      },
      findOne: (entity: unknown, opts: any) =>
        (manager.getRepository(entity) as any).findOne(opts),
      create: (entity: unknown, data: any) =>
        (manager.getRepository(entity) as any).create(data),
      save: (entityOrInstance: any, maybeInstance?: any) => {
        if (maybeInstance) {
          return (manager.getRepository(entityOrInstance) as any).save(
            maybeInstance,
          );
        }
        return (manager.getRepository(entityOrInstance.constructor) as any).save(
          entityOrInstance,
        );
      },
      update: (entity: unknown, where: any, patch: any) =>
        (manager.getRepository(entity) as any).update(where, patch),
      delete: (entity: unknown, where: any) =>
        (manager.getRepository(entity) as any).delete(where),
    };

    const withManager = <R extends object>(repo: R) =>
      Object.assign(repo, {
        manager: Object.assign(manager, {
          transaction: jest.fn((cb: (m: EntityManager) => Promise<unknown>) =>
            cb(manager as unknown as EntityManager),
          ),
        }),
      });

    const accountsRepoWithManager = withManager(accountsRepo);
    const refreshRepoWithManager = withManager(refreshRepo);

    const accountsService = new AccountsService(
      accountsRepoWithManager as unknown as Repository<Account>,
      crypto,
      passwordService,
    );

    const mailService = {
      sendGooglePassword: jest.fn((mail: { to: string; password: string }) => {
        sentGoogleMails.push({ to: mail.to, password: mail.password });
        return Promise.resolve(true);
      }),
      sendPasswordReset: jest.fn().mockResolvedValue(true),
      sendRegistrationOtp: jest.fn((mail: EmailOtpMail) => {
        sentOtpMails.push({ kind: 'REGISTER', mail });
        return Promise.resolve(true);
      }),
      sendEmailVerificationOtp: jest.fn((mail: EmailOtpMail) => {
        sentOtpMails.push({ kind: 'VERIFY_EMAIL', mail });
        return Promise.resolve(true);
      }),
      sendPasswordResetOtp: jest.fn((mail: EmailOtpMail) => {
        sentOtpMails.push({ kind: 'RESET_PASSWORD', mail });
        return Promise.resolve(true);
      }),
    } as unknown as MailService;

    const googleVerifier = {
      verify: jest.fn(() => Promise.resolve(googleProfile)),
    } as unknown as GoogleIdTokenVerifier;

    service = new AuthService(
      accountsRepoWithManager as unknown as Repository<Account>,
      refreshRepoWithManager as unknown as Repository<RefreshToken>,
      customerRepo as unknown as Repository<CustomerProfile>,
      ekycRepo as unknown as Repository<EkycRecord>,
      resetRepo as unknown as Repository<PasswordResetToken>,
      otpRepo as unknown as Repository<EmailOtp>,
      accountsService,
      passwordService,
      tokenService,
      googleVerifier,
      mailService,
      {} as EkycService,
      crypto,
    );
  });

  describe('OTP đăng ký (sendRegisterOtp / verifyRegisterOtp / register)', () => {
    it('gửi OTP 6 số, DB chỉ lưu SHA-256 hash; gửi lại trong 60s → 429 OTP_COOLDOWN', async () => {
      const res = await service.sendRegisterOtp({
        email: 'lan@example.com',
        fullName: 'Nguyễn Văn Lan',
      });
      expect(res).toEqual({
        success: true,
        expiresInSeconds: 300,
        cooldownSeconds: 60,
      });
      expect(sentOtpMails).toHaveLength(1);
      const otp = sentOtpMails[0].mail.otp;
      expect(otp).toMatch(/^\d{6}$/);
      expect(otpRows).toHaveLength(1);
      expect(otpRows[0].codeHash).not.toBe(otp);
      expect(otpRows[0].codeHash).toMatch(/^[0-9a-f]{64}$/);

      await expect(
        service.sendRegisterOtp({ email: 'lan@example.com' }),
      ).rejects.toThrow(HttpException);
      try {
        await service.sendRegisterOtp({ email: 'lan@example.com' });
      } catch (e) {
        const httpErr = e as HttpException;
        expect(httpErr.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      }
    });

    it('email đã đăng ký → 409 EMAIL_EXISTS', async () => {
      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
      });
      await expect(
        service.sendRegisterOtp({ email: 'lan@example.com' }),
      ).rejects.toThrow(new ConflictException('EMAIL_EXISTS'));
    });

    it('nhập sai OTP tăng attempts, sai 5 lần → 400 OTP_MAX_ATTEMPTS; hết hạn → OTP_EXPIRED', async () => {
      await service.sendRegisterOtp({ email: 'lan@example.com' });
      const realOtp = sentOtpMails[0].mail.otp;
      const wrongOtp = realOtp === '000000' ? '999999' : '000000';

      for (let i = 0; i < 4; i++) {
        await expect(
          service.verifyRegisterOtp({ email: 'lan@example.com', otp: wrongOtp }),
        ).rejects.toThrow(new BadRequestException('OTP_INVALID'));
      }
      await expect(
        service.verifyRegisterOtp({ email: 'lan@example.com', otp: wrongOtp }),
      ).rejects.toThrow(new BadRequestException('OTP_MAX_ATTEMPTS'));

      // Dùng OTP đúng sau khi đã khoá cũng không được
      await expect(
        service.verifyRegisterOtp({ email: 'lan@example.com', otp: realOtp }),
      ).rejects.toThrow(new BadRequestException('OTP_MAX_ATTEMPTS'));

      // Hết hạn
      otpRows.length = 0;
      await service.sendRegisterOtp({ email: 'lan2@example.com' });
      otpRows[0].expiresAt = new Date(Date.now() - 1000);
      await expect(
        service.verifyRegisterOtp({
          email: 'lan2@example.com',
          otp: sentOtpMails[1].mail.otp,
        }),
      ).rejects.toThrow(new BadRequestException('OTP_EXPIRED'));
    });

    it('đăng ký 2 bước qua verificationToken → đặt emailVerifiedAt; token sai email → 400', async () => {
      await service.sendRegisterOtp({ email: 'lan@example.com' });
      const { verified, verificationToken } = await service.verifyRegisterOtp({
        email: 'lan@example.com',
        otp: sentOtpMails[0].mail.otp,
      });
      expect(verified).toBe(true);

      await expect(
        service.register({
          email: 'khac@example.com',
          password: 'matkhau123',
          fullName: 'Khác',
          role: 'CUSTOMER',
          verificationToken,
        }),
      ).rejects.toThrow(
        new BadRequestException('EMAIL_VERIFICATION_TOKEN_INVALID'),
      );

      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
        verificationToken,
      });
      expect(accountRows[0].emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('đăng ký 1 bước với otp → tiêu thụ OTP & đặt emailVerifiedAt', async () => {
      await service.sendRegisterOtp({ email: 'lan@example.com' });
      const otp = sentOtpMails[0].mail.otp;

      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
        otp,
      });
      expect(accountRows[0].emailVerifiedAt).toBeInstanceOf(Date);
      expect(otpRows[0].consumedAt).toBeInstanceOf(Date);
    });

    it('đăng ký truyền thống không gửi OTP → tương thích ngược, emailVerifiedAt = null', async () => {
      await service.register({
        email: 'legacy@example.com',
        password: 'matkhau123',
        fullName: 'Legacy',
        role: 'CUSTOMER',
      });
      expect(accountRows[0].emailVerifiedAt).toBeNull();
    });
  });

  describe('Xác thực email sau đăng ký & Google Sign-In', () => {
    it('sendEmailVerificationOtp + verifyEmail → cập nhật emailVerifiedAt', async () => {
      await service.register({
        email: 'unverified@example.com',
        password: 'matkhau123',
        fullName: 'User',
        role: 'CUSTOMER',
      });
      expect(accountRows[0].emailVerifiedAt).toBeNull();

      await service.sendEmailVerificationOtp({
        email: 'unverified@example.com',
      });
      expect(sentOtpMails).toHaveLength(1);

      const verifyRes = await service.verifyEmail({
        email: 'unverified@example.com',
        otp: sentOtpMails[0].mail.otp,
      });
      expect(verifyRes).toEqual({ success: true, emailVerified: true });
      expect(accountRows[0].emailVerifiedAt).toBeInstanceOf(Date);
    });

    it('Google Sign-In tự đánh dấu emailVerifiedAt cho cả account mới lẫn account đăng ký thường trước đó', async () => {
      // Account đăng ký thường chưa verify email
      await service.register({
        email: 'hoa@gmail.com',
        password: 'matkhau123',
        fullName: 'Hoa',
        role: 'CUSTOMER',
      });
      expect(accountRows[0].emailVerifiedAt).toBeNull();

      await service.loginWithGoogle({ idToken: 'valid-token' });
      expect(accountRows[0].emailVerifiedAt).toBeInstanceOf(Date);

      // Account Google tạo mới hoàn toàn
      googleProfile = { email: 'new@gmail.com', fullName: 'New User' };
      const res = await service.loginWithGoogle({
        idToken: 'valid-token',
        role: 'PROVIDER',
      });
      expect(res.isNewAccount).toBe(true);
      const created = accountRows.find((a) => a.email === 'new@gmail.com')!;
      expect(created.emailVerifiedAt).toBeInstanceOf(Date);
    });
  });

  describe('Quên mật khẩu qua OTP (forgotPasswordOtp / verifyForgotPasswordOtp / resetPasswordWithOtp)', () => {
    it('email lạ vẫn trả success: true nhưng không gửi mail (anti-enumeration)', async () => {
      const res = await service.forgotPasswordOtp({
        email: 'khongtontai@example.com',
      });
      expect(res.success).toBe(true);
      expect(sentOtpMails).toHaveLength(0);
    });

    it('luồng 2 bước: forgotPasswordOtp → verifyForgotPasswordOtp → resetPassword', async () => {
      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
      });
      const loginTokens = await service.login({
        email: 'lan@example.com',
        password: 'matkhau123',
      });

      await service.forgotPasswordOtp({ email: 'lan@example.com' });
      expect(sentOtpMails).toHaveLength(1);

      const { verified, resetToken } = await service.verifyForgotPasswordOtp({
        email: 'lan@example.com',
        otp: sentOtpMails[0].mail.otp,
      });
      expect(verified).toBe(true);
      expect(resetToken).toBeTruthy();

      await service.resetPassword({
        token: resetToken,
        newPassword: 'matkhaumoi456',
      });

      await expect(
        service.login({ email: 'lan@example.com', password: 'matkhau123' }),
      ).rejects.toThrow();
      await expect(
        service.login({ email: 'lan@example.com', password: 'matkhaumoi456' }),
      ).resolves.toBeDefined();
      expect(refreshRows[0].revokedAt).toBeInstanceOf(Date);
      expect(loginTokens.refreshToken).toBeTruthy();
    });

    it('luồng 1 bước resetPasswordWithOtp → đổi mật khẩu + thu hồi mọi phiên', async () => {
      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
      });
      await service.login({ email: 'lan@example.com', password: 'matkhau123' });

      await service.forgotPasswordOtp({ email: 'lan@example.com' });
      const otp = sentOtpMails[0].mail.otp;

      await service.resetPasswordWithOtp({
        email: 'lan@example.com',
        otp,
        newPassword: 'matkhaumoi789',
      });

      await expect(
        service.login({ email: 'lan@example.com', password: 'matkhaumoi789' }),
      ).resolves.toBeDefined();
      expect(refreshRows[0].revokedAt).toBeInstanceOf(Date);
      // OTP đã dùng không dùng lại được lần 2
      await expect(
        service.resetPasswordWithOtp({
          email: 'lan@example.com',
          otp,
          newPassword: 'matkhaukhac999',
        }),
      ).rejects.toThrow(new BadRequestException('OTP_INVALID'));
    });
  });

  describe('Quản lý phiên đăng nhập (listSessions / revokeSession)', () => {
    it('listSessions chỉ trả các phiên đang hoạt động và không lộ tokenHash; revokeSession thu hồi đúng 1 phiên', async () => {
      await service.register({
        email: 'lan@example.com',
        password: 'matkhau123',
        fullName: 'Lan',
        role: 'CUSTOMER',
      });
      await service.login(
        { email: 'lan@example.com', password: 'matkhau123' },
        'Chrome/Win11',
      );
      await service.login(
        { email: 'lan@example.com', password: 'matkhau123' },
        'LanCareMobile/Android',
      );

      const user = { accountId: accountRows[0].id, role: 'CUSTOMER' as const };
      const sessions = await service.listSessions(user);
      expect(sessions).toHaveLength(2);
      expect(JSON.stringify(sessions)).not.toContain('tokenHash');

      const revoked = await service.revokeSession(user, sessions[0].id);
      expect(revoked).toEqual({ success: true });
      const after = await service.listSessions(user);
      expect(after).toHaveLength(1);

      await expect(
        service.revokeSession(
          { accountId: '99999999-9999-4999-8999-999999999999', role: 'CUSTOMER' },
          after[0].id,
        ),
      ).rejects.toThrow(new NotFoundException('SESSION_NOT_FOUND'));
    });
  });
});
