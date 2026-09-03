import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEmail,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';

export class RegisterProviderDto {
  @ApiProperty({ example: 'provider@lan.com' })
  @IsEmail({}, { message: 'EMAIL_INVALID' })
  email!: string;

  @ApiProperty({ example: 'Vườn Lan Orchid Care' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: '0901234567' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn A' })
  @IsOptional()
  @IsString()
  representative?: string;

  @ApiProperty({ enum: ['NURSERY', 'EXPERT'], example: 'NURSERY' })
  @IsEnum(['NURSERY', 'EXPERT'])
  providerType!: 'NURSERY' | 'EXPERT';

  @ApiPropertyOptional({ example: '123 Đường Số 1, Quận 1, TP.HCM' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ example: 'Tôi là chuyên gia về Lan Hồ Điệp...' })
  @IsOptional()
  @IsString()
  introduction?: string;

  // ===== DATA BỔ SUNG TỪ STEP 2 =====
  @ApiPropertyOptional({ example: '5 năm' })
  @IsOptional()
  @IsString()
  experience?: string;

  @ApiPropertyOptional({ example: 'Hồ Điệp, Dendro' })
  @IsOptional()
  @IsString()
  specialties?: string;

  @ApiPropertyOptional({ example: 'TP.HCM, Bình Dương' })
  @IsOptional()
  @IsString()
  serviceAreas?: string;

  @ApiPropertyOptional({ example: 'Chứng chỉ Nông nghiệp Ứng dụng cao' })
  @IsOptional()
  @IsString()
  certificates?: string;

  // ===== DATA BỔ SUNG TỪ STEP 3 (XÁC MINH HỒ SƠ) =====
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

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../portrait.jpg',
  })
  @IsOptional()
  @IsString()
  selfieUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../cccd-front.jpg',
  })
  @IsOptional()
  @IsString()
  cccdFrontUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../cccd-back.jpg',
  })
  @IsOptional()
  @IsString()
  cccdBackUrl?: string;

  @ApiPropertyOptional({
    example: 'https://res.cloudinary.com/.../business-license.jpg',
  })
  @IsOptional()
  @IsString()
  businessLicenseUrl?: string;
}
