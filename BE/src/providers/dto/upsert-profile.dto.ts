import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VN_PHONE_REGEX } from '../../common/identity';
import { toTrimmed } from '../../common/transforms';

// Trùng giá trị provider_type trong entity.
const PROVIDER_TYPES = ['NURSERY', 'EXPERT'] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];

// KHÔNG nhận verificationStatus/ratingAvg: provider không tự đặt được (chỉ admin/hệ thống).
// C1: mọi field optional → PUT kiểu merge (đổi mỗi 1 field không phải gửi lại cả hồ sơ).
// KHÔNG thu giữ/lưu trữ số CCCD, ảnh CCCD, ảnh chân dung.
export class UpsertProfileDto {
  @ApiPropertyOptional({ enum: PROVIDER_TYPES, example: 'NURSERY' })
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  providerType?: ProviderType;

  @ApiPropertyOptional({
    example: 'Vườn Lan Hoàng Gia',
    minLength: 2,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  displayName?: string;

  @ApiPropertyOptional({
    example: 'Nguyễn Văn Lan',
    description: 'Họ và tên người đại diện nhà vườn',
    minLength: 2,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({
    example: '15/08/1988',
    description: 'Ngày tháng năm sinh người đại diện',
  })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  dateOfBirth?: string;

  @ApiPropertyOptional({
    example: 'Huyện Bảo Lâm, Tỉnh Lâm Đồng',
    description: 'Quê quán người đại diện',
  })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  placeOfOrigin?: string;

  @ApiPropertyOptional({ example: 'Chuyên chăm sóc lan hồ điệp 10 năm.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  bio?: string;

  @ApiPropertyOptional({ example: 'Giấy phép kinh doanh số 0123456789' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  licenseInfo?: string;

  @ApiPropertyOptional({ example: 'https://portfolio.example.com' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  portfolioUrl?: string;

  @ApiPropertyOptional({ example: '0909123456' })
  @IsOptional()
  @IsString()
  @Matches(VN_PHONE_REGEX, { message: 'Số điện thoại Việt Nam chưa hợp lệ.' })
  phone?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../business-license.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  businessLicenseUrl?: string;

  // Địa chỉ thường trú / địa chỉ nhà vườn (dùng để hiển thị và đưa vào hợp đồng).
  @ApiPropertyOptional({ example: '12 Nguyễn Văn Bảo, Gò Vấp, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  // GPS do provider tự ghim trên bản đồ (client gửi tọa độ) — BE không geocode từ địa chỉ chữ.
  @ApiPropertyOptional({ example: 10.822154, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @ApiPropertyOptional({ example: 106.687557, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;

  @ApiPropertyOptional({ example: '5' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  experience?: string;

  @ApiPropertyOptional({ example: 'Hồ Điệp, Dendro, Vũ Nữ, Lan Hài' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  specialties?: string;

  @ApiPropertyOptional({ example: 'TP.HCM, Bình Dương' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  serviceAreas?: string;

  @ApiPropertyOptional({ example: 'Chứng chỉ nông nghiệp' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  certificates?: string;

  // Tài khoản nhận tiền công + tiền bảo đảm. Bắt buộc có trước khi admin duyệt và trước khi nhận đơn.
  // Gửi thì gửi đủ bankName + bankAccount + bankHolder (thiếu → 400 BANK_INFO_INCOMPLETE);
  // không xoá được (rỗng/null → 400 BANK_INFO_CANNOT_BE_CLEARED). Xem common/bank-info.ts.
  @ApiPropertyOptional({ example: 'Vietcombank' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(50)
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'NGUYEN VAN A' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankHolder?: string;

  // Mã BIN 6 số (không bắt buộc), chỉ gửi kèm bộ 3 trường trên; bộ 3 gửi không kèm BIN thì BIN về null.
  @ApiPropertyOptional({ example: '970436' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @Matches(/^(\d{6})?$/, { message: 'bankBin phải gồm 6 chữ số' })
  bankBin?: string;
}
