import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { VN_PHONE_REGEX } from '../../common/identity';
import { toTrimmed } from '../../common/transforms';

// PUT merge (C2): field không gửi giữ nguyên; muốn xoá phải gửi null tường minh.
export class UpsertCustomerProfileDto {
  @ApiPropertyOptional({ example: 'Nguyễn Văn Lan' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  fullName?: string;

  @ApiPropertyOptional({ example: '0909123456' })
  @IsOptional()
  @IsString()
  @Matches(VN_PHONE_REGEX, {
    message: 'Số điện thoại Việt Nam chưa hợp lệ.',
  })
  phone?: string;

  @ApiPropertyOptional({ example: '15/08/1995' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(20)
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'TP. Thủ Đức, TP. Hồ Chí Minh' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(255)
  placeOfOrigin?: string;

  @ApiPropertyOptional({ example: '25 Lê Lợi, Quận 1, TP.HCM' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  address?: string;

  @ApiPropertyOptional({ example: '25 Lê Lợi, Quận 1, TP.HCM (cổng sau)' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  defaultPickupAddress?: string;

  // GPS do khách tự ghim trên bản đồ (client gửi tọa độ) — BE không geocode từ địa chỉ chữ.
  @ApiPropertyOptional({ example: 10.776889, minimum: -90, maximum: 90 })
  @IsOptional()
  @IsNumber()
  @Min(-90)
  @Max(90)
  gpsLat?: number;

  @ApiPropertyOptional({ example: 106.700806, minimum: -180, maximum: 180 })
  @IsOptional()
  @IsNumber()
  @Min(-180)
  @Max(180)
  gpsLng?: number;

  // Tài khoản nhận tiền hoàn / tiền đền. Bắt buộc có trước khi đặt đơn và trước khi mở tranh chấp.
  // Gửi thì gửi đủ bankName + bankAccount + bankHolder (thiếu → 400 BANK_INFO_INCOMPLETE);
  // không xoá được (rỗng/null → 400 BANK_INFO_CANNOT_BE_CLEARED). Xem common/bank-info.ts.
  @ApiPropertyOptional({ example: 'MBBank' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankName?: string;

  @ApiPropertyOptional({ example: '0123456789' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(50)
  bankAccount?: string;

  @ApiPropertyOptional({ example: 'NGUYEN VAN MINH' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(100)
  bankHolder?: string;

  // Mã BIN 6 số (không bắt buộc), chỉ gửi kèm bộ 3 trường trên; bộ 3 gửi không kèm BIN thì BIN về null.
  @ApiPropertyOptional({ example: '970422' })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @Matches(/^(\d{6})?$/, { message: 'bankBin phải gồm 6 chữ số' })
  bankBin?: string;
}
