import { SetMetadata } from '@nestjs/common';
import type { Role } from '../../common/constants/roles';

export const ROLES_KEY = 'roles';

// Đánh dấu route chỉ cho phép các vai trò liệt kê. VD: @Roles('ADMIN') hoặc @Roles('PROVIDER','ADMIN').
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
