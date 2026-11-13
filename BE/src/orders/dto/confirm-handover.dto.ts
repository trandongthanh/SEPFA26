import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

export const HANDOVER_OBJECTION_MAX_PHOTOS = 10;

export class HandoverObjectionPhotoDto {
  @ApiProperty({ example: 'https://example.com/la-con-xanh.jpg' })
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @ApiPropertyOptional({ example: 'Lá cây A còn xanh lúc giao' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(500)
  caption?: string;
}

/**
 * Body POST /orders/:id/handover/confirm — khách đồng ý biên bản nhận cây. Cả hai field đều tuỳ chọn:
 * khách vẫn giao cây nhưng không đồng ý với kết quả vườn khám thì ghi ý kiến + ảnh, khoá cùng biên bản
 * để làm bằng chứng nếu tranh chấp lúc trả cây. Không muốn giao cây thì gọi /handover/decline.
 */
export class ConfirmHandoverDto {
  @ApiPropertyOptional({
    example: 'Vườn ghi cây A lá vàng sẵn, thực tế lá còn xanh',
  })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(2000)
  objectionNote?: string;

  @ApiPropertyOptional({ type: [HandoverObjectionPhotoDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(HANDOVER_OBJECTION_MAX_PHOTOS)
  @ValidateNested({ each: true })
  @Type(() => HandoverObjectionPhotoDto)
  objectionPhotos?: HandoverObjectionPhotoDto[];
}
