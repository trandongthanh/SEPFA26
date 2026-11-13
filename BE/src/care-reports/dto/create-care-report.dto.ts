import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import {
  EVIDENCE_TYPES,
  OVERALL_HEALTH,
  PART_CONDITION,
  SUBSTRATE_MOISTURE,
  type EvidenceType,
  type OverallHealth,
  type PartCondition,
  type SubstrateMoisture,
} from '../care-report.constants';

export class CareReportPhotoDto {
  @ApiProperty({ example: 'OVERVIEW', enum: EVIDENCE_TYPES })
  @IsIn(EVIDENCE_TYPES)
  evidenceType!: EvidenceType;

  @ApiProperty({
    example: 'https://res.cloudinary.com/demo/image/upload/lan-1.jpg',
  })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  photoUrl!: string;

  @ApiPropertyOptional({ example: 'Toàn cảnh cây' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(500)
  caption?: string;
}

/** Phần riêng của từng cây — mỗi cây đang chăm đúng 1 dòng. */
export class CareReportPlantDto {
  @ApiProperty({ example: '1b1d1ea8-1454-4e2a-8db1-3aa6c4f1e7f2' })
  @IsUUID()
  plantId!: string;

  @ApiProperty({
    example: 'MEDIUM',
    enum: SUBSTRATE_MOISTURE,
    description: 'Độ ẩm giá thể: Thấp / Vừa / Cao',
  })
  @IsIn(SUBSTRATE_MOISTURE)
  substrateMoisture!: SubstrateMoisture;

  @ApiProperty({
    example: 'GOOD',
    enum: PART_CONDITION,
    description: 'Tình trạng lá: Tốt / Bình thường / Xấu',
  })
  @IsIn(PART_CONDITION)
  leafCondition!: PartCondition;

  @ApiProperty({ example: 'NORMAL', enum: PART_CONDITION })
  @IsIn(PART_CONDITION)
  rootCondition!: PartCondition;

  @ApiProperty({ example: 'GOOD', enum: PART_CONDITION })
  @IsIn(PART_CONDITION)
  stemCondition!: PartCondition;

  @ApiProperty({ example: false, description: 'Có dấu hiệu sâu bệnh' })
  @IsBoolean()
  hasPestDisease!: boolean;

  @ApiProperty({
    example: 'GOOD',
    enum: OVERALL_HEALTH,
    description: 'Sức khỏe tổng thể: Tốt / Trung bình / Kém',
  })
  @IsIn(OVERALL_HEALTH)
  overallHealth!: OverallHealth;

  @ApiPropertyOptional({ example: 'Lá già phía gốc đã cắt bỏ' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiPropertyOptional({
    example: 18.5,
    description: 'Chiều dài lá dài nhất (cm)',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(200)
  leafLengthCm?: number;

  @ApiPropertyOptional({ example: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  leafCount?: number;

  @ApiPropertyOptional({ example: 3, description: 'Chiều dài rễ mới (cm)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(200)
  newRootLengthCm?: number;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  newShootCount?: number;

  @ApiPropertyOptional({ example: 1, description: 'Số vòi hoa' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  flowerSpikeCount?: number;

  @ApiPropertyOptional({ example: 5 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  budCount?: number;

  @ApiPropertyOptional({ example: 2 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1000)
  flowerCount?: number;

  @ApiProperty({
    type: [CareReportPhotoDto],
    description:
      'Bắt buộc ảnh OVERVIEW; lá/thân/rễ chấm POOR → bắt buộc ảnh LEAF/STEM/ROOT tương ứng; có sâu bệnh → ít nhất 1 ảnh cận',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ValidateNested({ each: true })
  @Type(() => CareReportPhotoDto)
  photos!: CareReportPhotoDto[];
}

/**
 * Body POST /care-reports. Client KHÔNG gửi kỳ — server tự gán kỳ kế tiếp.
 * Môi trường + hoạt động chăm + nước tưới là phần chung của đơn; `plants` là từng cây.
 */
export class CreateCareReportDto {
  @ApiProperty({ example: '1b1d1ea8-1454-4e2a-8db1-3aa6c4f1e7f2' })
  @IsUUID()
  serviceOrderId!: string;

  @ApiProperty({ example: 27.5, description: 'Nhiệt độ môi trường (°C)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(-10)
  @Max(60)
  airTemperature!: number;

  @ApiProperty({ example: 72, description: 'Độ ẩm không khí (%RH)' })
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(100)
  airHumidity!: number;

  @ApiProperty({ example: 18000, description: 'Cường độ ánh sáng (Lux)' })
  @IsInt()
  @Min(0)
  @Max(200000)
  lightIntensity!: number;

  @ApiProperty({ example: true })
  @IsBoolean()
  watered!: boolean;

  @ApiPropertyOptional({
    example: 500,
    description: 'Bắt buộc khi watered = true (ml)',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  waterAmountMl?: number;

  @ApiProperty({ example: false })
  @IsBoolean()
  fertilized!: boolean;

  @ApiPropertyOptional({
    example: 'NPK 20-20-20 pha loãng',
    description: 'Bắt buộc khi fertilized = true',
  })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  fertilizerType?: string;

  @ApiPropertyOptional({ example: 'Cắt tỉa lá già, vệ sinh chậu' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(2000)
  otherCareNote?: string;

  @ApiPropertyOptional({ example: 6.2, description: 'pH nước tưới' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 1 })
  @Min(0)
  @Max(14)
  waterPh?: number;

  @ApiPropertyOptional({ example: 0.8, description: 'EC nước tưới (mS/cm)' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(20)
  waterEc?: number;

  @ApiProperty({ type: [CareReportPlantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => CareReportPlantDto)
  plants!: CareReportPlantDto[];
}
