import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/**
 * Body POST /orders/:orderId/addons/:addonId/refund — vườn trả lại add-on khách đã trả tiền mà vườn
 * không làm được. Khách nhận lại đủ giá + 6%, chi ngay. Lý do khách đọc được.
 */
export class RefundAddonDto {
  @ApiProperty({
    example: 'Cây đang yếu, thay chậu lúc này dễ sốc rễ',
    description: 'Lý do trả lại (5–500 ký tự), khách xem được',
  })
  @Transform(toTrimmed)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
