import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { DISPUTE_STATUSES, type DisputeStatus } from '../dispute-rules';

/** Query GET /admin/disputes — limit trần 50 chống kéo cả bảng. */
export class QueryDisputeDto {
  @ApiPropertyOptional({ enum: DISPUTE_STATUSES, example: 'ADMIN_REVIEW' })
  @IsOptional()
  @IsIn(DISPUTE_STATUSES)
  status?: DisputeStatus;

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
