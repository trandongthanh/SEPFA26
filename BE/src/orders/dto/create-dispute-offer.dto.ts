import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/**
 * Body POST /orders/:orderId/dispute/offers — một đề nghị thương lượng gồm HAI số (đồng, chuỗi số nguyên):
 * hoàn tiền công (≤ tiền công gói + add-on đã trả) và tiền đền (≤ tổng mức đền các cây bị khiếu nại).
 * Hai số không được cùng bằng 0. Ví dụ đơn mẫu: hoàn công 100.000 + đền 1.000.000 → khách nhận 1.106.000.
 */
export class CreateDisputeOfferDto {
  @ApiProperty({
    example: '100000',
    description:
      'Tiền công hoàn cho khách, chưa gồm 6% phí dịch vụ hoàn kèm. Chuỗi số nguyên ≥ 0.',
  })
  @Matches(/^[0-9]{1,15}$/)
  refundAmount!: string;

  @ApiProperty({
    example: '1000000',
    description:
      'Tiền đền giá trị cây, lấy từ tiền bảo đảm. Chuỗi số nguyên ≥ 0.',
  })
  @Matches(/^[0-9]{1,15}$/)
  compensationAmount!: string;

  @ApiPropertyOptional({
    example: 'Vườn xin hoàn một nửa tiền công cây A và đền 1 triệu.',
  })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(2000)
  message?: string;
}
