import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import {
  SELF_REGISTER_ROLES,
  type SelfRegisterRole,
} from '../../common/constants/roles';

export class GoogleLoginDto {
  @ApiProperty({
    description:
      'Google ID token (JWT) lấy từ Google Identity Services (web) / Google Sign-In (mobile)',
  })
  @IsString()
  @IsNotEmpty()
  idToken!: string;

  @ApiPropertyOptional({
    enum: SELF_REGISTER_ROLES,
    description:
      'Chỉ cần khi email Google CHƯA có tài khoản (lần đầu) — loại tài khoản muốn tạo. Tài khoản đã có thì bỏ qua.',
  })
  @IsOptional()
  @IsIn(SELF_REGISTER_ROLES)
  role?: SelfRegisterRole;
}
