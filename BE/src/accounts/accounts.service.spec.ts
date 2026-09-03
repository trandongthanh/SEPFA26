import { describe, expect, it } from '@jest/globals';
import { AccountsService } from './accounts.service';
import { Account } from './entities/account.entity';

const service = new AccountsService({} as never, {} as never, {} as never);

describe('AccountsService.isAllowedToAuthenticate', () => {
  it('allows an active account and a pending provider', () => {
    expect(
      service.isAllowedToAuthenticate({
        role: 'CUSTOMER',
        status: 'ACTIVE',
      } as Pick<Account, 'role' | 'status'>),
    ).toBe(true);
    expect(
      service.isAllowedToAuthenticate({
        role: 'PROVIDER',
        status: 'PENDING',
      } as Pick<Account, 'role' | 'status'>),
    ).toBe(true);
  });

  it('continues to deny suspended accounts and pending non-providers', () => {
    expect(
      service.isAllowedToAuthenticate({
        role: 'PROVIDER',
        status: 'SUSPENDED',
      } as Pick<Account, 'role' | 'status'>),
    ).toBe(false);
    expect(
      service.isAllowedToAuthenticate({
        role: 'CUSTOMER',
        status: 'PENDING',
      } as Pick<Account, 'role' | 'status'>),
    ).toBe(false);
  });
});
