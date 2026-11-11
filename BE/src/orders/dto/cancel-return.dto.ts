import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /orders/:id/return/cancel — vườn huỷ phiên trả để hẹn lại. */
export class CancelReturnDto {
  @ApiProperty({ example: 'Khách vắng nhà, hẹn chiều mai' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
