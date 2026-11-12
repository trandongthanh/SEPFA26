import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export const DISBURSEMENT_STATUSES = ['PENDING', 'PAID'] as const;
export type DisbursementStatus = (typeof DISBURSEMENT_STATUSES)[number];

/** Query GET /admin/disbursements — limit trần 50 chống kéo cả bảng. */
export class QueryDisbursementDto {
  @ApiPropertyOptional({ enum: DISBURSEMENT_STATUSES, example: 'PENDING' })
  @IsOptional()
  @IsIn(DISBURSEMENT_STATUSES)
  status?: DisbursementStatus;

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
