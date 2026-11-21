import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsUUID, Max, Min } from 'class-validator';

// GET /orders/pickup-fee-quote — cùng tên field với POST /orders để FE/Mobile dùng lại state đặt đơn.
// Query string luôn là chuỗi → @Type ép sang số trước khi kiểm.
export class QueryPickupFeeQuoteDto {
  @ApiProperty({ example: '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' })
  @IsUUID()
  servicePackageId!: string;

  @ApiProperty({ example: 10.7769, description: 'Vĩ độ điểm lấy cây' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Vui lòng chọn vị trí lấy cây trên bản đồ.' })
  @Min(-90)
  @Max(90)
  pickupGpsLat!: number;

  @ApiProperty({ example: 106.7009, description: 'Kinh độ điểm lấy cây' })
  @Type(() => Number)
  @IsNumber({}, { message: 'Vui lòng chọn vị trí lấy cây trên bản đồ.' })
  @Min(-180)
  @Max(180)
  pickupGpsLng!: number;
}
