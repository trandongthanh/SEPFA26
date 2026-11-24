import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';
import { toTrimmed } from '../../common/transforms';

/** Body POST /orders/:orderId/addons — vườn đề xuất một việc phát sinh ngoài gói. */
export class CreateAddonDto {
  @ApiProperty({ example: 'Thay giá thể' })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  title!: string;

  @ApiProperty({
    example: 'Giá thể đã mục, rễ bắt đầu úng. Cần thay dớn mới để cứu rễ.',
  })
  @Transform(toTrimmed)
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  reason!: string;

  @ApiProperty({
    example: '100000',
    description:
      'Giá add-on, đồng, chuỗi số nguyên. Từ 1.000 đến 50.000.000. Chưa gồm 6% phí dịch vụ khách trả thêm.',
  })
  @Matches(/^[0-9]{1,11}$/)
  price!: string;

  @ApiProperty({
    type: [String],
    example: ['https://res.cloudinary.com/demo/re-ung.jpg'],
    description: 'Ảnh minh chứng lý do, 1–5 link https',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsUrl({ protocols: ['https'], require_protocol: true }, { each: true })
  @MaxLength(500, { each: true })
  photoUrls!: string[];

  @ApiPropertyOptional({
    example: '3f2c1d7e-5b0a-4c7e-9d2f-1a2b3c4d5e6f',
    description:
      'Cây được làm (phải là cây đang chăm của đơn). Bỏ trống = cả đơn.',
  })
  @IsOptional()
  @IsUUID()
  plantId?: string;
}
