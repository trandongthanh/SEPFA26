import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LogoutDto {
  @ApiPropertyOptional({
    description:
      'Refresh token cần thu hồi (logout 1 thiết bị). Bỏ trống = logout mọi thiết bị.',
  })
  @IsOptional()
  @IsString()
  refreshToken?: string;
}
