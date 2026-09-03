import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

// Trùng giá trị provider_type trong entity.
const PROVIDER_TYPES = ['NURSERY', 'EXPERT'] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];

// KHÔNG nhận verificationStatus/ratingAvg: provider không tự đặt được (chỉ admin/hệ thống).
// C1: mọi field optional → PUT kiểu merge (đổi mỗi 1 field không phải gửi lại cả hồ sơ).
// Hồ sơ đã được auto-tạo lúc register nên providerType/displayName luôn tồn tại sẵn.
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
  @MaxLength(500) // khớp cột portfolio_url varchar(500)
  portfolioUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../portrait.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  selfieUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../cccd-front.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cccdFrontUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../cccd-back.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  cccdBackUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../business-license.jpg',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  businessLicenseUrl?: string;

  // 3 field vị trí KHÔNG thuộc nhóm nhạy cảm (đổi không rớt về PENDING) — chỉ là thông tin vận hành.
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
  experience?: string;

  @ApiPropertyOptional({ example: 'Hồ Điệp, Dendro, Vũ Nữ, Lan Hài' })
  @IsOptional()
  @IsString()
  specialties?: string;

  @ApiPropertyOptional({ example: 'TP.HCM, Bình Dương' })
  @IsOptional()
  @IsString()
  serviceAreas?: string;

  @ApiPropertyOptional({ example: 'Chứng chỉ nông nghiệp' })
  @IsOptional()
  @IsString()
  certificates?: string;

  @ApiPropertyOptional({ example: 'Vietcombank' })
  @IsOptional()
  @IsString()
  bankName?: string;

  @ApiPropertyOptional({ example: '1234567890' })
  @IsOptional()
  @IsString()
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'NGUYEN VAN A' })
  @IsOptional()
  @IsString()
  bankHolder?: string;
}
