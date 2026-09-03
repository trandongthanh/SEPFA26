import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const WEATHER_VALUES = ['SUNNY', 'RAINY', 'OVERCAST', 'NORMAL'] as const;
const SUBSTRATE_STATUS_VALUES = [
  'DRY_READY_TO_WATER',
  'MOIST_GOOD',
  'WATERLOGGED_RISK',
] as const;
const ROOT_STATUS_VALUES = [
  'ROOTS_HEALTHY_GROWING',
  'ROOTS_STABLE',
  'ROOTS_AFFECTED',
] as const;
const LEAF_STATUS_VALUES = [
  'LEAVES_FIRM_AND_HEALTHY',
  'STEM_TURGID_GOOD',
  'BASE_LEAVES_YELLOW_REMOVED',
  'LEAF_ROT_BLACKSPOT_BURN',
] as const;
const SHOOT_STATUS_VALUES = ['SHOOTS_UNIFORM', 'FLOWERS_UNIFORM'] as const;
const DISEASE_PREVENTION_VALUES = [
  'DISINFECT_GARDEN',
  'SPRAY_BACTERIA_FUNGUS',
  'SNAIL_TREATMENT',
  'NONE',
] as const;

export class EvidenceItemDto {
  @ApiProperty({ example: 'OVERVIEW', enum: ['OVERVIEW', 'ROOT', 'LEAF_OR_SHOOT'] })
  @IsEnum(['OVERVIEW', 'ROOT', 'LEAF_OR_SHOOT'] as const)
  evidenceType!: 'OVERVIEW' | 'ROOT' | 'LEAF_OR_SHOOT';

  @ApiProperty({ example: 'https://example.com/images/overview.jpg' })
  @IsString()
  @IsNotEmpty()
  @IsUrl({ protocols: ['https'], require_protocol: true })
  @MaxLength(500)
  photoUrl!: string;

  @ApiPropertyOptional({ example: 'Tổng quan vườn lan' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;
}

export class CreateCareReportDto {
  @ApiProperty({ example: '1b1d1ea8-1454-4e2a-8db1-3aa6c4f1e7f2' })
  @IsUUID()
  serviceOrderId!: string;

  @ApiProperty({ example: '2026-08-09T00:00:00.000Z' })
  @IsDateString()
  periodStart!: string;

  @ApiProperty({ example: '2026-08-12T00:00:00.000Z' })
  @IsDateString()
  periodEnd!: string;

  @ApiProperty({ example: 'Cây cà chua' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  plantNameSnapshot!: string;

  @ApiProperty({ example: 'CT-001' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  plantCodeSnapshot!: string;

  @ApiProperty({ example: 'Khu A - Luống 02' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  plotPositionSnapshot!: string;

  @ApiProperty({ example: 'SUNNY', enum: WEATHER_VALUES })
  @IsEnum(WEATHER_VALUES)
  weather!: (typeof WEATHER_VALUES)[number];

  @ApiProperty({ example: 24 })
  @IsNumber()
  temperatureMin!: number;

  @ApiProperty({ example: 31 })
  @IsNumber()
  temperatureMax!: number;

  @ApiProperty({ example: 60 })
  @IsNumber()
  humidityMin!: number;

  @ApiProperty({ example: 82 })
  @IsNumber()
  humidityMax!: number;

  @ApiProperty({ example: 'MOIST_GOOD', enum: SUBSTRATE_STATUS_VALUES })
  @IsEnum(SUBSTRATE_STATUS_VALUES)
  substrateStatus!: (typeof SUBSTRATE_STATUS_VALUES)[number];

  @ApiProperty({ example: 'ROOTS_HEALTHY_GROWING', enum: ROOT_STATUS_VALUES })
  @IsEnum(ROOT_STATUS_VALUES)
  rootStatus!: (typeof ROOT_STATUS_VALUES)[number];

  @ApiPropertyOptional({ example: 1, description: 'Chỉ cần khi rootStatus = ROOTS_AFFECTED' })
  @IsOptional()
  @IsInt()
  @Min(1)
  rootAffectedCount?: number;

  @ApiProperty({ example: 'LEAVES_FIRM_AND_HEALTHY', enum: LEAF_STATUS_VALUES })
  @IsEnum(LEAF_STATUS_VALUES)
  leafStatus!: (typeof LEAF_STATUS_VALUES)[number];

  @ApiProperty({ example: 'SHOOTS_UNIFORM', enum: SHOOT_STATUS_VALUES })
  @IsEnum(SHOOT_STATUS_VALUES)
  shootStatus!: (typeof SHOOT_STATUS_VALUES)[number];

  @ApiProperty({ example: 2 })
  @IsInt()
  @Min(0)
  wateringCount!: number;

  @ApiPropertyOptional({ example: 'Bón phân NPK, tưới đều' })
  @IsOptional()
  @IsString()
  nutritionNote?: string;

  @ApiProperty({ example: 'DISINFECT_GARDEN', enum: DISEASE_PREVENTION_VALUES })
  @IsEnum(DISEASE_PREVENTION_VALUES)
  diseasePrevention!: (typeof DISEASE_PREVENTION_VALUES)[number];

  @ApiProperty({
    type: [EvidenceItemDto],
    minItems: 3,
    maxItems: 3,
    example: [
      {
        evidenceType: 'OVERVIEW',
        photoUrl: 'https://example.com/images/overview.jpg',
        caption: 'Tổng quan vườn',
      },
      {
        evidenceType: 'ROOT',
        photoUrl: 'https://example.com/images/root.jpg',
        caption: 'Rễ cây',
      },
      {
        evidenceType: 'LEAF_OR_SHOOT',
        photoUrl: 'https://example.com/images/leaf-shoot.jpg',
        caption: 'Lá và chồi',
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(3)
  @ArrayMaxSize(3)
  @ValidateNested({ each: true })
  @Type(() => EvidenceItemDto)
  evidences!: EvidenceItemDto[];
}
