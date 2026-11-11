import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { AssessmentPhotoDto } from './assess-plant.dto';

/**
 * Body POST /orders/:id/return/plants/:plantId/assess — vườn ghi tình trạng cây lúc trả.
 * Không có quyết định hay giá: lúc trả chỉ ghi nhận, không đổi tiền.
 * checklist tự do (jsonb) như lúc nhận cây; photos ≥ 1 làm bằng chứng.
 */
export class AssessReturnPlantDto {
  @ApiProperty({ example: { leaf: 'xanh', root: 'chắc', pest: false } })
  @IsObject()
  checklist!: Record<string, unknown>;

  @ApiProperty({ example: 'Ra 1 ngồng mới', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;

  @ApiProperty({
    type: [AssessmentPhotoDto],
    example: [
      {
        photoUrl: 'https://res.cloudinary.com/demo/out-1.jpg',
        caption: 'Toàn cây',
      },
    ],
  })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AssessmentPhotoDto)
  photos!: AssessmentPhotoDto[];
}
