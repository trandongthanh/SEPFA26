import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /orders/:id/handover/cancel — vườn huỷ vì không nộp được tiền bảo đảm. */
export class CancelHandoverDto {
  @ApiProperty({ example: 'Không chuẩn bị đủ tiền bảo đảm' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
