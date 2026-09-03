import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/** Body POST /orders/:id/negotiation/respond — chỉ ACCEPT/REJECT, không có COUNTER. */
export class RespondNegotiationDto {
  @IsIn(['ACCEPT', 'REJECT'])
  response!: 'ACCEPT' | 'REJECT';

  @IsOptional()
  @Matches(/^\d{1,15}$/)
  proposedTotal?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  pickupLocation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  providerNote?: string;
}
