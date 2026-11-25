import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  PAYMENT_CLAIM_STATUSES,
  PaymentClaimStatus,
} from '../payment-claim-rules';
import { PAYMENT_CLAIM_MAX_AMOUNT } from './create-payment-claim.dto';

/**
 * Query GET /admin/payment-claims — admin lọc phiếu theo trạng thái và số tiền khai
 * (vd 530000 để đối chiếu với khoản tiền chưa khớp cùng số). limit trần 50 như các danh sách admin khác.
 */
export class QueryPaymentClaimDto {
  @ApiPropertyOptional({ enum: PAYMENT_CLAIM_STATUSES, example: 'OPEN' })
  @IsOptional()
  @IsIn(PAYMENT_CLAIM_STATUSES)
  status?: PaymentClaimStatus;

  @ApiPropertyOptional({
    example: 530000,
    description: 'Số tiền khai trên phiếu (đồng), khớp đúng',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAYMENT_CLAIM_MAX_AMOUNT)
  amount?: number;

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
