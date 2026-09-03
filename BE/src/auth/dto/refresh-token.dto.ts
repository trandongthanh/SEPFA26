import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({ description: 'Refresh token nhận được khi đăng nhập' })
  @IsString()
  refreshToken!: string;
}
