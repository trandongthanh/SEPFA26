import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Allow,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  SELF_REGISTER_ROLES,
  type SelfRegisterRole,
} from '../../common/constants/roles';
import { toNormalizedEmail, toTrimmed } from '../../common/transforms';

// Đăng ký chỉ tạo ACCOUNT "base" (PENDING). SĐT, CCCD, hồ sơ customer/provider
// nộp ở bước kích hoạt tài khoản — không thuộc luồng đăng ký.
export class RegisterDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  // Chuẩn hoá chữ thường + trim → chặn tạo trùng do hoa/thường.
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({ example: 'matkhau123', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  // bcrypt cắt ở 72 byte — chặn trên 64 để mật khẩu không bị cắt âm thầm.
  @MaxLength(64)
  password!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan', minLength: 2, maxLength: 150 })
  @Transform(toTrimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  fullName!: string;

  @ApiProperty({ enum: SELF_REGISTER_ROLES, example: 'CUSTOMER' })
  @IsIn(SELF_REGISTER_ROLES)
  role!: SelfRegisterRole;

  // ===== TƯƠNG THÍCH TẠM — xoá khi FE/Mobile đã bỏ các field này khỏi form đăng ký =====
  // Form cũ vẫn gửi SĐT (+ thông tin vườn). BE NHẬN nhưng BỎ QUA (không lưu, không
  // validate) để đăng ký không bị 400 do forbidNonWhitelisted. Các field này nay
  // thuộc bước kích hoạt tài khoản.
  @ApiPropertyOptional({
    deprecated: true,
    description: 'Bị bỏ qua — nộp ở bước kích hoạt',
  })
  @Allow()
  phone?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Bị bỏ qua — nộp ở bước kích hoạt',
  })
  @Allow()
  providerType?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Bị bỏ qua — nộp ở bước kích hoạt',
  })
  @Allow()
  address?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Bị bỏ qua — nộp ở bước kích hoạt',
  })
  @Allow()
  gpsLat?: unknown;

  @ApiPropertyOptional({
    deprecated: true,
    description: 'Bị bỏ qua — nộp ở bước kích hoạt',
  })
  @Allow()
  gpsLng?: unknown;
}
