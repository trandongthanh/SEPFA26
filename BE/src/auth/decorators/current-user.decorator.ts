import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { CurrentUserData } from '../types/current-user.type';

// Lấy user hiện tại từ request.user (do JwtStrategy.validate gắn vào).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserData => {
    const request = ctx.switchToHttp().getRequest<{ user: CurrentUserData }>();
    return request.user;
  },
);
