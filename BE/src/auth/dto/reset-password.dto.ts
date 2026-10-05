import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({
    description:
      'Token trong link đặt lại mật khẩu (query `token` của link gửi qua mail)',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  @ApiProperty({ example: 'matkhaumoi456', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  // bcrypt cắt ở 72 byte — chặn trên 64 để mật khẩu không bị cắt âm thầm.
  @MaxLength(64)
  newPassword!: string;
}
