import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'oldPassword123' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: 'newPassword456', minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}
