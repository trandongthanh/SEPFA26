import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'oldPassword123' })
  @IsString()
  currentPassword!: string;

  @ApiProperty({ example: 'newPassword456', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  // bcrypt cắt ở 72 byte — chặn trên 64 để mật khẩu không bị cắt âm thầm.
  @MaxLength(64)
  newPassword!: string;
}
