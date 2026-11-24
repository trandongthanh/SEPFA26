import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { toNormalizedEmail, toTrimmed } from '../../common/transforms';

export class SendRegisterOtpDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiPropertyOptional({ example: 'Nguyễn Văn Lan', maxLength: 150 })
  @IsOptional()
  @Transform(toTrimmed)
  @IsString()
  @MaxLength(150)
  fullName?: string;
}

export class SendEmailOtpDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Mã OTP gồm đúng 6 chữ số được gửi về email',
  })
  @Transform(toTrimmed)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp!: string;
}

export class ResetPasswordWithOtpDto {
  @ApiProperty({ example: 'customer@lancarehub.vn' })
  @Transform(toNormalizedEmail)
  @IsEmail()
  @MaxLength(255)
  email!: string;

  @ApiProperty({
    example: '123456',
    description: 'Mã OTP 6 chữ số từ email quên mật khẩu',
  })
  @Transform(toTrimmed)
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP phải gồm đúng 6 chữ số' })
  otp!: string;

  @ApiProperty({ example: 'matkhaumoi456', minLength: 8, maxLength: 64 })
  @IsString()
  @MinLength(8)
  @MaxLength(64)
  newPassword!: string;
}
