import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';
import { DISPUTE_VERDICTS, type DisputeVerdict } from '../dispute-rules';

export class DisputePlantVerdictDto {
  @ApiProperty({ example: '3f2c1d7e-5b0a-4c7e-9d2f-1a2b3c4d5e6f' })
  @IsUUID()
  plantId!: string;

  @ApiProperty({
    enum: DISPUTE_VERDICTS,
    example: 'VALUE_LOST',
    description:
      'NOT_AT_FAULT vườn không lỗi · SERVICE_FAULT vườn lỗi, chỉ hoàn tiền công cây đó · VALUE_LOST vườn lỗi và cây mất giá trị (hoàn tiền công + đền trọn mức đền)',
  })
  @IsIn(DISPUTE_VERDICTS)
  verdict!: DisputeVerdict;
}

/**
 * Body POST /admin/disputes/:disputeId/resolve — admin KHÔNG nhập tiền, chỉ kết luận từng cây bị khiếu nại
 * (đủ mọi cây, không thiếu, không dư, không trùng); hệ thống tự ra tiền.
 */
export class ResolveDisputeDto {
  @ApiProperty({ type: [DisputePlantVerdictDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => DisputePlantVerdictDto)
  plants!: DisputePlantVerdictDto[];

  @ApiProperty({
    example:
      'Biên bản nhận ghi cây A khoẻ, không cờ rủi ro; báo cáo kỳ 2–4 không có ảnh cây A. Kết luận vườn làm chết cây.',
  })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  note!: string;
}
