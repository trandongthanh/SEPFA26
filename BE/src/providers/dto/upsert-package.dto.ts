import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  MaxLength,
  MinLength,
} from 'class-validator';

// Giá/phí đơn vị đồng, số nguyên không âm — dùng chung cho basePrice/declaredValue.
// C11: trần 1_000_000_000_000 (1 nghìn tỷ đồng) — chặn tràn bigint gây lỗi 500.
const MONEY_MAX = Number.MAX_SAFE_INTEGER;
const BASE_PRICE_MIN = 10_000;

export class UpsertPackageDto {
  @ApiProperty({
    example: 'Gói chăm sóc lan 30 ngày',
    minLength: 2,
    maxLength: 255,
  })
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  name!: string;

  @ApiPropertyOptional({ example: 'Bao gồm tưới nước, bón phân định kỳ.' })
  @IsString()
  @MinLength(1, { message: 'Mô tả gói dịch vụ không được để trống.' })
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ example: 30, minimum: 1 })
  @IsInt()
  @Min(1)
  durationDays!: number;

  @ApiProperty({ example: 7, minimum: 1 })
  @IsInt()
  @Min(1)
  reportFrequencyDays!: number;

  @ApiProperty({ example: 10, minimum: 1 })
  @IsInt()
  @Min(1)
  maxPlants!: number;

  @ApiProperty({ example: 500000, minimum: 0, description: 'Đơn vị: đồng' })
  @IsInt({ message: 'Giá gói phải là số nguyên (VNĐ).' })
  @Min(BASE_PRICE_MIN, { message: 'Giá gói phải từ 10.000 VNĐ trở lên.' })
  @Max(MONEY_MAX, { message: 'Giá gói quá lớn.' })
  basePrice!: number;

  // Mức bồi thường mặc định đã bao gồm trong basePrice (kiểu FedEx/UPS declared value).
  @ApiProperty({ example: 1000000, minimum: 0 })
  @IsInt({ message: 'Giá trị khai báo tối thiểu phải là số nguyên (VNĐ).' })
  @Min(0, { message: 'Giá trị khai báo tối thiểu không được âm.' })
  @Max(MONEY_MAX, { message: 'Giá trị khai báo tối thiểu quá lớn.' })
  minDeclaredValue!: number;

  // Trần tối đa cho phép khách khai báo thêm để nâng mức bồi thường.
  @ApiProperty({ example: 5000000, minimum: 0 })
  @IsInt({ message: 'Giá trị khai báo tối đa phải là số nguyên (VNĐ).' })
  @Min(0, { message: 'Giá trị khai báo tối đa không được âm.' })
  @Max(MONEY_MAX, { message: 'Giá trị khai báo tối đa quá lớn.' })
  maxDeclaredValue!: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
