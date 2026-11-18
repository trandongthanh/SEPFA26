import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/**
 * Body POST /orders/:id/cancel — khách hoặc vườn huỷ đơn trước khi vườn mở phiên nhận cây.
 * Chỉ gửi lý do: mã lý do và số tiền hoàn do server tự quyết theo vai, trạng thái đơn và giờ hẹn.
 */
export class CancelOrderDto {
  @ApiProperty({ example: 'Tôi đổi kế hoạch, không gửi cây nữa' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
