import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

// OPEN = chưa xử lý (chưa có lệnh hoàn), RESOLVED = đã tạo lệnh hoàn.
export const UNMATCHED_FILTERS = ['OPEN', 'RESOLVED'] as const;
export type UnmatchedFilter = (typeof UNMATCHED_FILTERS)[number];

/** Query GET /admin/unmatched-transactions — limit trần 50 như danh sách lệnh chi. */
export class QueryUnmatchedTransactionDto {
  @ApiPropertyOptional({ enum: UNMATCHED_FILTERS, example: 'OPEN' })
  @IsOptional()
  @IsIn(UNMATCHED_FILTERS)
  status?: UnmatchedFilter;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 10;
}
