import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsNumber,
  IsString,
  MaxLength,
  MinLength,
  Min,
  Max,
  ValidateIf,
  Matches,
} from 'class-validator';

// KHÔNG cho đăng ký ADMIN qua API public.
const SELF_REGISTER_ROLES = ['CUSTOMER', 'PROVIDER'] as const;
type SelfRegisterRole = (typeof SELF_REGISTER_ROLES)[number];

const PROVIDER_TYPES = ['NURSERY', 'EXPERT'] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];

export class RegisterDto {
  @ApiProperty({
    example: 'customer@lancarehub.vn',
    description: 'Email đăng nhập',
  })
  // B3: chuẩn hoá về chữ thường + bỏ khoảng trắng → chặn tạo trùng do hoa/thường.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({
    example: 'matkhau123',
    minLength: 8,
    maxLength: 64,
    description: 'Mật khẩu, 8–64 ký tự',
  })
  @IsString()
  @MinLength(8)
  // B8: bcrypt cắt ở 72 byte — chặn trên 64 để mật khẩu không bị cắt âm thầm.
  @MaxLength(64)
  password!: string;

  @ApiProperty({ example: 'Nguyễn Văn Lan', minLength: 2 })
  @IsString()
  @MinLength(2)
  fullName!: string;

  @ApiProperty({
    example: '0909123456',
    description: 'Số điện thoại (sẽ được mã hóa khi lưu)',
  })
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s.()-]/g, '') : value,
  )
  @Matches(/^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/, {
    message: 'Số điện thoại Việt Nam chưa hợp lệ.',
  })
  phone!: string;

  @ApiProperty({
    enum: SELF_REGISTER_ROLES,
    example: 'CUSTOMER',
    description: 'Vai trò đăng ký. Chỉ CUSTOMER hoặc PROVIDER.',
  })
  @IsEnum(SELF_REGISTER_ROLES)
  role!: SelfRegisterRole;

  @ApiProperty({
    enum: PROVIDER_TYPES,
    example: 'NURSERY',
    required: false,
    description:
      'Bắt buộc khi role=PROVIDER. Loại nhà cung cấp: vườn ươm hoặc chuyên gia.',
  })
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  providerType?: ProviderType;

  @IsOptional()
  @IsString({ message: 'Địa chỉ nhà vườn là bắt buộc.' })
  @MinLength(3, { message: 'Địa chỉ nhà vườn chưa hợp lệ.' })
  @MaxLength(255)
  address?: string;

  @ValidateIf((dto: RegisterDto) => dto.role === 'PROVIDER')
  @IsNumber({}, { message: 'Vui lòng chọn vị trí nhà vườn trên bản đồ.' })
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @ValidateIf((dto: RegisterDto) => dto.role === 'PROVIDER')
  @IsNumber({}, { message: 'Vui lòng chọn vị trí nhà vườn trên bản đồ.' })
  @Min(-180)
  @Max(180)
  gpsLng?: number;
}
