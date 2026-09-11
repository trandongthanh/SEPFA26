import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

// PUT merge (C2): field không gửi giữ nguyên; muốn xoá phải gửi null tường minh.
export class UpsertCustomerProfileDto {
  @ApiPropertyOptional({ example: '0909123456' })
  @IsOptional()
  @IsString()
  @Matches(/^(?:\+84|84|0)(?:3|5|7|8|9)\d{8}$/, {
    message: 'Số điện thoại Việt Nam chưa hợp lệ.',
  })
  phone?: string;

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

  @ApiPropertyOptional({ description: 'Số căn cước công dân (12 chữ số)', example: '001234567890' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{12}$/, { message: 'Số căn cước phải gồm đúng 12 chữ số.' })
  cccdNumber?: string;

  @ApiPropertyOptional({ description: 'URL ảnh mặt trước CCCD/Căn cước' })
  @IsOptional()
  @IsUrl({}, { message: 'Ảnh CCCD mặt trước chưa hợp lệ.' })
  @MaxLength(500)
  cccdFrontUrl?: string;

  @ApiPropertyOptional({ description: 'URL ảnh mặt sau CCCD/Căn cước' })
  @IsOptional()
  @IsUrl({}, { message: 'Ảnh CCCD mặt sau chưa hợp lệ.' })
  @MaxLength(500)
  cccdBackUrl?: string;

  @ApiPropertyOptional({ description: 'URL ảnh selfie người dùng cầm CCCD/Căn cước' })
  @IsOptional()
  @IsUrl({}, { message: 'Ảnh selfie cùng căn cước chưa hợp lệ.' })
  @MaxLength(500)
  selfieWithIdUrl?: string;
}
