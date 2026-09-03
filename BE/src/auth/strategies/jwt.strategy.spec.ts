import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AccountsService } from '../../accounts/accounts.service';
import { Account } from '../../accounts/entities/account.entity';
import { JwtStrategy } from './jwt.strategy';
import type { JwtPayload } from '../token.service';
import { jest, describe, it, expect } from '@jest/globals';

const config = {
  get: (name: string) =>
    name === 'JWT_ACCESS_SECRET'
      ? 'test-access-secret-xxxxxxxxxxxxxxxxxx'
      : undefined,
} as unknown as ConfigService;

const makeStrategy = (account: Account | null) => {
  // Giữ tham chiếu trực tiếp tới mock fn để assert (tránh truy cập method qua object).
  const findAuthenticatableById = jest
    .fn<() => Promise<Account | null>>()
    .mockResolvedValue(account);
  const accounts = { findAuthenticatableById } as unknown as AccountsService;
  return {
    strategy: new JwtStrategy(config, accounts),
    findAuthenticatableById,
  };
};

const accessPayload: JwtPayload = {
  sub: 'acc-1',
  role: 'CUSTOMER',
  type: 'access',
  jti: 'test-jti-1',
};

describe('JwtStrategy.validate', () => {
  it('trả { accountId, role } khi token access hợp lệ và account ACTIVE', async () => {
    const account = {
      id: 'acc-1',
      role: 'CUSTOMER',
      status: 'ACTIVE',
    } as Account;
    const { strategy } = makeStrategy(account);

    await expect(strategy.validate(accessPayload)).resolves.toEqual({
      accountId: 'acc-1',
      role: 'CUSTOMER',
    });
  });

  it('ném 401 khi type không phải access (vd refresh token đem qua guard)', async () => {
    const { strategy, findAuthenticatableById } = makeStrategy(null);
    const refreshPayload: JwtPayload = { ...accessPayload, type: 'refresh' };

    await expect(strategy.validate(refreshPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // không cần tra DB vì đã loại sớm theo type
    expect(findAuthenticatableById).not.toHaveBeenCalled();
  });

  it('ném 401 khi account không còn ACTIVE / không tồn tại', async () => {
    const { strategy } = makeStrategy(null); // findActiveById trả null
    await expect(strategy.validate(accessPayload)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
