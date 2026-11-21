import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /admin/disbursements/:id/mark-paid — admin đã chuyển khoản tay xong mới bấm. */
export class MarkDisbursementPaidDto {
  @ApiProperty({
    example: 'FT26317123456',
    description: 'Mã giao dịch chuyển khoản của ngân hàng',
  })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  transferCode!: string;

  @ApiPropertyOptional({ example: 'Chuyển qua MBBank lúc 10:15' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
