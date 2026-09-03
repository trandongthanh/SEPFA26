import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';

export class ShippingRateInputDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  minKm!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  maxKm?: number | null;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  baseFee!: number;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  perKmFee!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  billingUnitKm?: number | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ReplaceShippingRatesDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ShippingRateInputDto)
  rates!: ShippingRateInputDto[];
}
