import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/**
 * Query GET /care-reports — luôn phân trang, trả { data, total, page, limit }.
 * limit mặc định: xem theo 1 đơn → 50 (đủ mọi kỳ của một đơn, app không phải lật trang); còn lại → 10.
 */
export class QueryCareReportDto {
  @IsOptional()
  @IsUUID()
  serviceOrderId?: string;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 9, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  // Tìm trong mã đơn, tên khách, ghi chú báo cáo, tên cây, ghi chú từng cây — không phân biệt dấu.
  @ApiPropertyOptional({ example: 'lan ho', maxLength: 100 })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  q?: string;

  // late=true → chỉ báo cáo nộp trễ (is_late). Query string là chữ nên đổi 'true'/'false' sang boolean.
  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  late?: boolean;
}
