import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /admin/payment-claims/:id/reject — lý do hiện cho người nộp để họ nộp lại phiếu đúng. */
export class RejectPaymentClaimDto {
  @ApiProperty({
    example: 'Ảnh sao kê không thấy số tiền và giờ chuyển, vui lòng chụp lại',
    description: 'Lý do từ chối, 5–500 ký tự',
  })
  @Transform(toTrimmed)
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason!: string;
}
