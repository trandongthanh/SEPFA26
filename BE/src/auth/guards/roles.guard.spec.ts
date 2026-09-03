import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { describe, it, expect } from '@jest/globals';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import type { Role } from '../../common/constants/roles';
import type { CurrentUserData } from '../types/current-user.type';

const makeContext = (user?: CurrentUserData): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  }) as unknown as ExecutionContext;

const makeGuard = (requiredRoles: Role[] | undefined) => {
  const reflector = {
    getAllAndOverride: () => requiredRoles,
  } as unknown as Reflector;
  return new RolesGuard(reflector);
};

describe('RolesGuard', () => {
  it('route không gắn @Roles → cho qua', () => {
    const guard = makeGuard(undefined);
    expect(
      guard.canActivate(makeContext({ accountId: 'a', role: 'CUSTOMER' })),
    ).toBe(true);
  });

  it('user có đúng vai trò yêu cầu → cho qua', () => {
    const guard = makeGuard(['ADMIN']);
    expect(
      guard.canActivate(makeContext({ accountId: 'a', role: 'ADMIN' })),
    ).toBe(true);
  });

  it('user sai vai trò → ném 403', () => {
    const guard = makeGuard(['ADMIN']);
    expect(() =>
      guard.canActivate(makeContext({ accountId: 'a', role: 'CUSTOMER' })),
    ).toThrow(ForbiddenException);
  });
});
