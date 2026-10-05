import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SELF_REGISTER_ROLES,
  type SelfRegisterRole,
} from '../../common/constants/roles';
import { toNormalizedEmail, toTrimmed } from '../../common/transforms';

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
  @Transform(toTrimmed)
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
  @Transform(toTrimmed)
  @IsOptional()
  @IsString()
  phone?: string;
}
