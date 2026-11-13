import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /orders/:orderId/addons/:addonId/complete — vườn báo đã làm xong add-on. */
export class CompleteAddonDto {
  @ApiProperty({
    type: [String],
    example: ['https://res.cloudinary.com/demo/da-thay-gia-the.jpg'],
    description: 'Ảnh sau khi làm, 1–5 link https',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @MaxLength(500, { each: true })
  photoUrls!: string[];

  @ApiPropertyOptional({ example: 'Đã thay dớn mới, cắt 3 rễ úng' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(1000)
  note?: string;
}
