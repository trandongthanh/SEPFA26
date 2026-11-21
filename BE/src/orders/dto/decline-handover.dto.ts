import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /orders/:id/handover/decline — khách không giao cây sau khi xem biên bản vườn khám. */
export class DeclineHandoverDto {
  @ApiProperty({ example: 'Không đồng ý kết quả khám, không giao cây nữa' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;
}
