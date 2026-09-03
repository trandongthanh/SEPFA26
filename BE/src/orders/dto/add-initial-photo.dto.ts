import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
} from 'class-validator';

/**
 * Body POST /orders/:id/plants/:plantId/initial-photos.
 * Client upload storage ngoài rồi gửi URL (storage = mục CHƯA CHỐT của SPEC_MASTER).
 */
export class AddInitialPhotoDto {
  @IsUrl({ require_protocol: true })
  @IsNotEmpty()
  @MaxLength(500)
  photoUrl!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  caption?: string;

  @IsOptional()
  @IsObject()
  analysis?: Record<string, unknown>;
}
