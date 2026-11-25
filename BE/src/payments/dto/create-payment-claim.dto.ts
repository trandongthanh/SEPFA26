import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import { PAYMENT_CLAIM_MAX_PHOTOS } from '../payment-claim-rules';

// Trần chặn số vô lý (gõ nhầm thêm số 0) — một lần chuyển của đơn chăm cây không tới mức này.
export const PAYMENT_CLAIM_MAX_AMOUNT = 10_000_000_000;

/** Một ảnh sao kê — URL lấy từ POST /uploads/provider-document. */
export class PaymentClaimPhotoDto {
  @ApiProperty({ example: 'https://res.cloudinary.com/demo/sao-ke-1.jpg' })
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;
}

/**
 * Body POST /orders/:orderId/payment-claims — người của đơn báo đã chuyển tiền nhưng chưa được ghi nhận.
 * Ví dụ: chị Lan chuyển 530.000 lúc 10:15 quên ghi mã đơn → amount 530000, 2 ảnh sao kê.
 * Bên nộp (khách / vườn) do BE suy từ người gọi, không gửi.
 */
export class CreatePaymentClaimDto {
  @ApiProperty({
    example: 530000,
    description: 'Số tiền đã chuyển (đồng), số nguyên > 0',
  })
  @IsInt()
  @Min(1)
  @Max(PAYMENT_CLAIM_MAX_AMOUNT)
  amount!: number;

  @ApiPropertyOptional({
    example: '2026-11-25T10:15:00+07:00',
    description: 'Giờ chuyển theo sao kê (ISO 8601)',
  })
  @IsOptional()
  @IsISO8601()
  transferredAt?: string;

  @ApiPropertyOptional({ example: 'Em quên ghi mã đơn' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    type: [PaymentClaimPhotoDto],
    description: 'Ảnh sao kê / biên lai chuyển khoản, 1–3 ảnh.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(PAYMENT_CLAIM_MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => PaymentClaimPhotoDto)
  photos!: PaymentClaimPhotoDto[];
}
