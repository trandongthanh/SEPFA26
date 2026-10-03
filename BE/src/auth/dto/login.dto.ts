import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';
import { toNormalizedEmail } from '../../common/transforms';

export class LoginDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  // Chuẩn hoá khớp với lúc đăng ký → gõ hoa/thường vẫn đăng nhập đúng.
  @Transform(toNormalizedEmail)
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'matkhau123' })
  @IsString()
  password!: string;
}
