import { ApiProperty } from '@nestjs/swagger';
import { ROLES, ACCOUNT_STATUSES } from '../../common/constants/roles';

// Thông tin account rút gọn trả kèm khi đăng nhập.
export class AccountSummaryDto {
  @ApiProperty({ example: 'b3f1c2a4-...', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan' })
  fullName!: string;

  @ApiProperty({ enum: ROLES, example: 'CUSTOMER' })
  role!: string;
}

// Response của login & refresh: cặp 2 token.
export class AuthTokensResponseDto {
  @ApiProperty({
    description: 'Access token (sống ngắn ~15m), gửi kèm mọi request',
  })
  accessToken!: string;

  @ApiProperty({
    description: 'Refresh token (sống dài ~7d), chỉ gửi tới /auth/refresh',
  })
  refreshToken!: string;

  @ApiProperty({ type: AccountSummaryDto, required: false })
  account?: AccountSummaryDto;
}

// Response của register: KHÔNG trả token (bắt đăng nhập riêng).
export class RegisterResponseDto {
  @ApiProperty({ format: 'uuid' })
  accountId!: string;

  @ApiProperty({ example: 'customer@lancarehub.vn' })
  email!: string;

  @ApiProperty({ enum: ROLES, example: 'CUSTOMER' })
  role!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, example: 'ACTIVE' })
  status!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
