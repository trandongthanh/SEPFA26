import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import { ORDER_STATUSES, OrderStatus } from '../order-status';

export const ORDER_LIST_SORTS = ['newest', 'oldest', 'pickupSoon'] as const;
export type OrderListSort = (typeof ORDER_LIST_SORTS)[number];

/** Query GET /orders — @Type ép chuỗi query string sang số; limit trần 50 chống kéo cả bảng. */
export class QueryOrderDto {
  @IsOptional()
  @IsIn(ORDER_STATUSES)
  status?: OrderStatus;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;

  // Tìm trong mã đơn, tên khách, tên gói, tên cây — không phân biệt dấu, hoa thường.
  @ApiPropertyOptional({ example: 'lan ho', maxLength: 100 })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  // newest = mới tạo trước (mặc định), oldest = cũ trước, pickupSoon = giờ hẹn lấy cây gần nhất trước.
  @ApiPropertyOptional({ enum: ORDER_LIST_SORTS, example: 'newest' })
  @IsOptional()
  @IsIn(ORDER_LIST_SORTS)
  sort?: OrderListSort;
}
