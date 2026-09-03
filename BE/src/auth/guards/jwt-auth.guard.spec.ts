import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtAuthGuard } from './jwt-auth.guard';
import { describe, it, expect, jest } from '@jest/globals';

// Tạo ExecutionContext giả tối thiểu (chỉ cần getHandler/getClass cho guard này).
const makeContext = (): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class { },
  }) as unknown as ExecutionContext;

describe('JwtAuthGuard', () => {
  it('cho qua ngay khi route đánh dấu @Public (không gọi Passport)', () => {
    const reflector = {
      getAllAndOverride: () => true, // giả lập route có metadata isPublic=true
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    expect(guard.canActivate(makeContext())).toBe(true);
  });

  it('route không public -> ủy quyền cho Passport (super.canActivate)', () => {
    const reflector = {
      getAllAndOverride: () => undefined, // không có metadata public
    } as unknown as Reflector;
    const guard = new JwtAuthGuard(reflector);

    // Theo dõi super.canActivate có được gọi không (trả 'PASSPORT' để nhận biết).
    const superProto = Object.getPrototypeOf(JwtAuthGuard.prototype) as {
      canActivate: () => unknown;
    };
    const spy = jest
      .spyOn(superProto, 'canActivate')
      .mockReturnValue('PASSPORT');

    expect(guard.canActivate(makeContext())).toBe('PASSPORT');
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});