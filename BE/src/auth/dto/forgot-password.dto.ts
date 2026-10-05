import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';
import { toNormalizedEmail } from '../../common/transforms';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  // Chuẩn hoá giống lúc đăng ký → gõ hoa/thường vẫn tìm đúng account.
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}
