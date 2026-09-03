import { ArrayMinSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, IsUrl, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
class DisputeEvidenceDto { @IsUrl({ require_protocol: true }) photoUrl!: string; @IsOptional() @IsString() @MaxLength(500) caption?: string; }
export class OpenDisputeDto {
  @IsIn(['MISMATCHED_PLANT', 'DAMAGE', 'PICKUP', 'OTHER']) reason!: string;
  @IsString() @IsNotEmpty() @MaxLength(4000) description!: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => DisputeEvidenceDto) evidence!: DisputeEvidenceDto[];
}
export class ResolveDisputeDto { @IsIn(['RESOLVED', 'REJECTED']) status!: 'RESOLVED' | 'REJECTED'; @IsString() @IsNotEmpty() @MaxLength(4000) resolution!: string; }
