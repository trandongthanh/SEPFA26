import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

// Trùng giá trị handover_decision trong entity Plant.
const DECISIONS = ['ACCEPT', 'ACCEPT_HIGH_RISK', 'ADJUST', 'REJECT'] as const;
type Decision = (typeof DECISIONS)[number];

export class AssessmentPhotoDto {
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;
}

/**
 * Body POST /orders/:id/handover/plants/:plantId/assess.
 * checklist = jsonb tự do (tiêu chí thẩm định theo loài, không ép schema);
 * photos ≥ 1 — bằng chứng bắt buộc khi trách nhiệm đổi tay.
 */
export class AssessPlantDto {
  @IsObject()
  checklist!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @IsIn(DECISIONS)
  decision!: Decision;

  @IsBoolean()
  isHighRisk!: boolean;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssessmentPhotoDto)
  photos!: AssessmentPhotoDto[];
}
