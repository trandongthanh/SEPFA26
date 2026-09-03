import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  // B3: chuẩn hoá khớp với lúc đăng ký → gõ hoa/thường vẫn đăng nhập đúng.
  @Transform(({ value }) =>
    typeof value === 'string' ? value.toLowerCase().trim() : value,
  )
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'matkhau123' })
  @IsString()
  password!: string;
}
