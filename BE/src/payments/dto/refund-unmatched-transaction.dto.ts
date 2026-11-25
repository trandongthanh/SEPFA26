import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/**
 * Body POST /admin/unmatched-transactions/:id/refund.
 * Không gửi tài khoản → dùng tài khoản trong hồ sơ người nhận gợi ý. Gửi thì gửi đủ bankName + bankAccount
 * + bankHolder (thiếu → 400 BANK_INFO_INCOMPLETE). Ghi chú bắt buộc khi tiền không gắn đơn hoặc tài khoản
 * khác tài khoản gợi ý (400 RESOLUTION_NOTE_REQUIRED).
 * `claimId` (không bắt buộc): hoàn kèm phiếu báo đã chuyển tiền → phiếu RESOLVED. Tiền không gắn đơn thì
 * người nhận gợi ý = người nộp phiếu (TK trong hồ sơ của họ), ghi chú vẫn bắt buộc.
 */
export class RefundUnmatchedTransactionDto {
  @ApiPropertyOptional({
    example: '6f1c2b7e-1d2a-4c3b-9e8f-0a1b2c3d4e5f',
    description: 'Phiếu báo đã chuyển tiền đi kèm (phải đang OPEN)',
  })
  @IsOptional()
  @IsUUID()
  claimId?: string;

  @ApiPropertyOptional({ example: 'MBBank' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(50)
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'NGUYEN VAN A' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankHolder?: string;

  @ApiPropertyOptional({ example: '970422' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @Matches(/^(\d{6})?$/, { message: 'bankBin phải gồm 6 chữ số' })
  bankBin?: string;

  @ApiPropertyOptional({
    example: 'Khách gửi ảnh sao kê, người nhà chuyển hộ',
  })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
