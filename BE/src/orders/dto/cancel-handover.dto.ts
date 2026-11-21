import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

export const HANDOVER_CANCEL_MAX_PHOTOS = 5;

// Vườn huỷ tại cửa khi CHƯA tới bước nộp tiền bảo đảm:
//   CUSTOMER_ABSENT       — khách vắng nhà (bắt buộc ảnh chụp tại chỗ) → vườn giữ phí lấy cây;
//   PROVIDER_CANNOT_SERVE — vườn không nhận (từ chối hết cây, tự bỏ) → hoàn khách 100%.
export const HANDOVER_CANCEL_REASON_CODES = [
  'CUSTOMER_ABSENT',
  'PROVIDER_CANNOT_SERVE',
] as const;
export type HandoverCancelReasonCode =
  (typeof HANDOVER_CANCEL_REASON_CODES)[number];

export class HandoverCancelPhotoDto {
  @ApiProperty({ example: 'https://example.com/cong-nha-khach.jpg' })
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  // Toạ độ điện thoại của vườn lúc chụp — được phép bỏ trống (tắt định vị, mất sóng GPS).
  @ApiPropertyOptional({ example: 10.7701 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @ApiPropertyOptional({ example: 106.7002 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;
}

/**
 * Body POST /orders/:id/handover/cancel — vườn huỷ ở chặng nhận cây.
 *   - Đang chờ nộp tiền bảo đảm (khách đã đồng ý biên bản): chỉ cần `reason`, như cũ.
 *   - Chưa tới bước đó (phiên đang mở, hoặc đã chốt biên bản mà khách chưa trả lời): bắt buộc `reasonCode`;
 *     `CUSTOMER_ABSENT` bắt buộc thêm 1–5 ảnh.
 */
export class CancelHandoverDto {
  @ApiProperty({ example: 'Không chuẩn bị đủ tiền bảo đảm' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @ApiPropertyOptional({ enum: HANDOVER_CANCEL_REASON_CODES })
  @IsOptional()
  @IsIn(HANDOVER_CANCEL_REASON_CODES)
  reasonCode?: HandoverCancelReasonCode;

  @ApiPropertyOptional({ type: [HandoverCancelPhotoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HANDOVER_CANCEL_MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => HandoverCancelPhotoDto)
  photos?: HandoverCancelPhotoDto[];
}
