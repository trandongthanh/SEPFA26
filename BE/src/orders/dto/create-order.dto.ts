import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsNumber,
  IsUUID,
  Matches,
  MaxLength,
  ValidateNested,
  Min,
  Max,
} from 'class-validator';

// D4: chuỗi SỐ NGUYÊN dương (VNĐ) — chặn dấu chấm/âm/rỗng để BigInt() không ném (500).
const MONEY_INT = /^\d{1,15}$/;
// D8: ISO 8601 BẮT BUỘC có múi giờ (Z hoặc ±hh:mm) — tránh lệch giờ do TZ của server.
const ISO_WITH_TZ =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

export class CreateOrderPlantDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  speciesName?: string;

  @IsOptional()
  @IsBoolean()
  isValueDeclared?: boolean;

  // bigint dạng chuỗi SỐ NGUYÊN (VNĐ) — khoảng min/max của gói do service check.
  @IsOptional()
  @Matches(MONEY_INT, { message: 'declaredValue phải là số nguyên dương' })
  declaredValue?: string;
}

/**
 * Body POST /orders — KHÔNG có field tiền nào: mọi con số do server tính + snapshot.
 * Chi tiết từng field: docs/api-contracts/orders.md
 */
export class CreateOrderDto {
  @IsUUID()
  servicePackageId!: string;

  // Giờ hẹn lấy cây (ISO 8601 CÓ múi giờ) — mốc duy nhất của luật hủy;
  // "phải ở tương lai" do service check. D8: bắt buộc TZ để không lệch giờ trên prod.
  @Matches(ISO_WITH_TZ, {
    message:
      'scheduledPickupAt phải là ISO 8601 kèm múi giờ (vd 2026-08-05T08:00:00+07:00)',
  })
  scheduledPickupAt!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  pickupAddress?: string;

  @IsNumber({}, { message: 'Vui lòng chọn vị trí lấy cây trên bản đồ.' })
  @Min(-90)
  @Max(90)
  pickupGpsLat!: number;

  @IsNumber({}, { message: 'Vui lòng chọn vị trí lấy cây trên bản đồ.' })
  @Min(-180)
  @Max(180)
  pickupGpsLng!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  customerNote?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderPlantDto)
  plants!: CreateOrderPlantDto[];
}
