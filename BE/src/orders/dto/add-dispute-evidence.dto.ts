import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import {
  DISPUTE_EVIDENCE_MAX_PHOTOS,
  DisputeEvidencePhotoDto,
} from './open-dispute.dto';

/**
 * Body POST /orders/:orderId/dispute/evidence — khách hoặc vườn nộp thêm bằng chứng khi tranh chấp
 * chưa kết thúc (kể cả lúc đang chờ admin). Bên nộp suy từ vai trò người gọi, không gửi trong body.
 */
export class AddDisputeEvidenceDto {
  @ApiPropertyOptional({
    example: 'Ảnh báo cáo kỳ 3 cho thấy cây đã yếu từ lúc nhận.',
  })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({
    type: [DisputeEvidencePhotoDto],
    description: '1–10 ảnh mỗi lần nộp.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DISPUTE_EVIDENCE_MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => DisputeEvidencePhotoDto)
  photos!: DisputeEvidencePhotoDto[];
}
