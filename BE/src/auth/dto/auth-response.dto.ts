import { ApiProperty } from '@nestjs/swagger';
import { ACCOUNT_STATUSES, ROLES } from '../../common/constants/roles';

export class AccountSummaryDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'customer@lancarehub.vn' })
  email!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan' })
  fullName!: string;

  @ApiProperty({ enum: ROLES, example: 'CUSTOMER' })
  role!: string;

  @ApiProperty({
    enum: ACCOUNT_STATUSES,
    example: 'PENDING',
    description: 'PENDING = chưa kích hoạt (FE điều hướng sang nộp hồ sơ)',
  })
  status!: string;
}

// Response của login / google / refresh.
export class AuthTokensResponseDto {
  @ApiProperty({ description: 'Access token (sống ngắn ~15m)' })
  accessToken!: string;

  @ApiProperty({
    description: 'Refresh token (sống dài ~7d), chỉ gửi tới /auth/refresh',
  })
  refreshToken!: string;

  @ApiProperty({ type: AccountSummaryDto })
  account!: AccountSummaryDto;
}

// Riêng /auth/google: báo FE biết vừa tạo tài khoản mới (hiện thông báo "đã gửi mật khẩu qua mail").
export class GoogleAuthResponseDto extends AuthTokensResponseDto {
  @ApiProperty({ example: false })
  isNewAccount!: boolean;
}

// Response của register: KHÔNG trả token (bắt đăng nhập riêng). Giữ shape cũ cho FE.
export class RegisterResponseDto {
  @ApiProperty({ format: 'uuid' })
  accountId!: string;

  @ApiProperty({ example: 'customer@lancarehub.vn' })
  email!: string;

  @ApiProperty({ enum: ROLES, example: 'CUSTOMER' })
  role!: string;

  @ApiProperty({ enum: ACCOUNT_STATUSES, example: 'PENDING' })
  status!: string;
}

export class LogoutResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;
}
