import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SELF_REGISTER_ROLES,
  type SelfRegisterRole,
} from '../../common/constants/roles';
import { toNormalizedEmail } from '../../common/transforms';

export class RegisterWithEkycDto {
  @ApiProperty({
    example: 'customer@lancarehub.vn',
    description: 'Địa chỉ email đăng ký (duy nhất trong hệ thống)',
  })
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: 'MatKhau123@',
    minLength: 8,
    maxLength: 64,
    description: 'Mật khẩu đăng nhập (tối thiểu 8 ký tự)',
  })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  password!: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn Lan',
    description: 'Họ và tên (tuỳ chọn — nếu không gửi, hệ thống tự lấy họ tên đã OCR từ thẻ CCCD)',
  })
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  @MaxLength(150)
  fullName?: string;

  @ApiPropertyOptional({
    enum: SELF_REGISTER_ROLES,
    example: 'CUSTOMER',
    default: 'CUSTOMER',
    description: 'Loại tài khoản: CUSTOMER hoặc PROVIDER (mặc định CUSTOMER)',
  })
  @IsOptional()
  @IsIn(SELF_REGISTER_ROLES)
  role: SelfRegisterRole = 'CUSTOMER';

  @ApiPropertyOptional({
    example: '0901234567',
    description: 'Số điện thoại liên hệ (tuỳ chọn)',
  })
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : typeof value === 'string' ? value.trim() : value))
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({
    example: '123456',
    description: 'Mã OTP 6 chữ số xác thực email khi đăng ký (tuỳ chọn)',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? undefined
      : typeof value === 'string'
        ? value.trim()
        : value,
  )
  @IsOptional()
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp?: string;

  @ApiPropertyOptional({
    description: 'Token xác thực email nhận từ /auth/register/verify-otp (tuỳ chọn)',
  })
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim() === ''
      ? undefined
      : typeof value === 'string'
        ? value.trim()
        : value,
  )
  @IsOptional()
  @IsString()
  @MaxLength(512)
  verificationToken?: string;

  // Cho phép Swagger hoặc Client gửi field rỗng cho file mà không bị chặn bởi forbidNonWhitelisted
  @Allow()
  cccdFront?: unknown;

  @Allow()
  selfie?: unknown;
}
