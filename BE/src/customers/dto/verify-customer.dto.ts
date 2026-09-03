import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';

export class VerifyCustomerDto {
  @IsEnum(['APPROVED', 'REJECTED'])
  decision!: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  note?: string;
}
