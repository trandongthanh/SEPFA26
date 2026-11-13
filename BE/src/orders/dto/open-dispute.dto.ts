import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

// Mỗi lần nộp (lúc mở tranh chấp hoặc nộp thêm) tối đa 10 ảnh — cùng mức với ảnh phản đối lúc nhận cây.
export const DISPUTE_EVIDENCE_MAX_PHOTOS = 10;

/** Một ảnh bằng chứng — dùng chung cho lúc mở tranh chấp và lúc nộp thêm. */
export class DisputeEvidencePhotoDto {
  @ApiProperty({ example: 'https://example.com/cay-a-heo.jpg' })
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @ApiPropertyOptional({ example: 'Cây A héo toàn bộ lá lúc nhận lại' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(500)
  caption?: string;

  @ApiPropertyOptional({
    example: '3f2c1d7e-5b0a-4c7e-9d2f-1a2b3c4d5e6f',
    description:
      'Ảnh nói về cây nào (phải là cây vườn đã nhận chăm của đơn). Bỏ trống = nói chung.',
  })
  @IsOptional()
  @IsUUID()
  plantId?: string;
}

/**
 * Body POST /orders/:orderId/dispute — khách mở tranh chấp trong 48 giờ sau khi vườn chốt trả cây.
 * Ví dụ đơn mẫu: cây A chết → plantIds [A], 1 ảnh gắn cây A.
 */
export class OpenDisputeDto {
  @ApiProperty({ example: 'Cây chết sau kỳ chăm' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  reason!: string;

  @ApiProperty({
    example: 'Nhận lại cây A thì toàn bộ lá đã héo, rễ thối, không cứu được.',
  })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  description!: string;

  @ApiProperty({
    type: [String],
    example: ['3f2c1d7e-5b0a-4c7e-9d2f-1a2b3c4d5e6f'],
    description:
      'Các cây bị khiếu nại: ít nhất 1, không trùng, đều là cây vườn đã nhận chăm của đơn.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  plantIds!: string[];

  @ApiProperty({
    type: [DisputeEvidencePhotoDto],
    description: 'Ảnh bằng chứng của khách, 1–10 ảnh.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DISPUTE_EVIDENCE_MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => DisputeEvidencePhotoDto)
  evidence!: DisputeEvidencePhotoDto[];
}
