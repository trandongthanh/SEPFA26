import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';
import { OVERALL_HEALTH } from '../../care-reports/care-report.constants';
import type { OverallHealth } from '../../care-reports/care-report.constants';
import { toTrimmed } from '../../common/transforms';

/**
 * Body POST /orders/:orderId/addons/:addonId/complete — vườn báo đã làm xong add-on.
 * Đây cũng là báo cáo add-on khách xem: ảnh sau khi làm + mô tả việc đã làm + tình trạng cây sau khi làm.
 */
export class CompleteAddonDto {
  @ApiProperty({
    type: [String],
    example: ['https://res.cloudinary.com/demo/da-thay-gia-the.jpg'],
    description: 'Ảnh sau khi làm, 1–5 link https',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @MaxLength(500, { each: true })
  photoUrls!: string[];

  @ApiProperty({
    example: 'Đã thay dớn mới, cắt 3 rễ úng',
    description: 'Mô tả việc đã làm, 10–1000 ký tự',
  })
  @Transform(toTrimmed)
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  note!: string;

  @ApiPropertyOptional({
    enum: OVERALL_HEALTH,
    example: 'GOOD',
    description:
      'Tình trạng cây sau khi làm. Bắt buộc khi add-on gắn một cây; không gửi khi add-on cho cả đơn',
  })
  @IsOptional()
  @IsIn(OVERALL_HEALTH)
  plantHealthAfter?: OverallHealth;
}
