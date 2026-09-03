import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// Trùng giá trị provider_type trong entity (NURSERY=vườn ươm, EXPERT=chuyên gia).
const PROVIDER_TYPES = ['NURSERY', 'EXPERT'] as const;
type ProviderType = (typeof PROVIDER_TYPES)[number];

export class QueryProviderDto {
  @ApiPropertyOptional({
    enum: PROVIDER_TYPES,
    description: 'Lọc theo loại provider',
  })
  @IsOptional()
  @IsEnum(PROVIDER_TYPES)
  type?: ProviderType;

  @ApiPropertyOptional({
    example: 4,
    minimum: 0,
    maximum: 5,
    description: 'Rating tối thiểu',
  })
  @IsOptional()
  @Type(() => Number) // query là chuỗi → ép sang số trước khi validate
  // C8: rating lưu numeric(3,2) → cho nhận số thập phân (4.5), không ép nguyên.
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ example: 'lan', description: 'Tìm theo tên hiển thị' })
  @IsOptional()
  @IsString()
  @MaxLength(100) // C12: chặn chuỗi tìm kiếm rác quá dài
  keyword?: string;

  @ApiPropertyOptional({ example: 1, minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ example: 10, minimum: 1, maximum: 50, default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50) // chặn trên: tránh khách ép trả quá nhiều bản ghi
  limit: number = 10;
}
