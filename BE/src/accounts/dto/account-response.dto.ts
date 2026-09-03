import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLES, ACCOUNT_STATUSES } from '../../common/constants/roles';

// Response của GET /accounts/me. KHÔNG bao giờ chứa passwordHash. phone đã giải mã.
export class AccountResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'customer@lancarehub.vn' })
  email!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan' })
  fullName!: string;

  @ApiPropertyOptional({
    example: '0909123456',
    description: 'Đã giải mã khi trả ra',
  })
  phone?: string | null;

  @ApiProperty({ enum: ROLES, example: 'CUSTOMER' })
  role!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, example: 'ACTIVE' })
  status!: string;
}
