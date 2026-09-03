import type { Role } from '../../common/constants/roles';

export interface CurrentUserData {
  accountId: string;
  role: Role;
}
