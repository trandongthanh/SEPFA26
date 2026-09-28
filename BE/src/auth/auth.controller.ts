import { Body, Controller, Headers, HttpCode, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUserData } from './types/current-user.type';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { GoogleLoginDto } from './dto/google-login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  AuthTokensResponseDto,
  GoogleAuthResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

// Controller mỏng: chỉ map HTTP → AuthService. User-Agent được lưu kèm refresh token để
// nhận diện phiên/thiết bị khi tra bảng refresh_tokens. Nghiệp vụ + mã lỗi: xem AuthService.
@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Đăng ký tài khoản base (CUSTOMER/PROVIDER, status PENDING)',
  })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'EMAIL_EXISTS' })
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đăng nhập email + mật khẩu' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({ status: 403, description: 'ACCOUNT_SUSPENDED' })
  login(
    @Body() dto: LoginDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthTokensResponseDto> {
    return this.auth.login(dto, userAgent);
  }

  @Public()
  @Post('google')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Đăng nhập / đăng ký bằng Google ID token. Lần đầu cần role; tài khoản mới nhận mật khẩu qua mail',
  })
  @ApiResponse({ status: 200, type: GoogleAuthResponseDto })
  @ApiResponse({
    status: 401,
    description: 'INVALID_GOOGLE_TOKEN | GOOGLE_EMAIL_NOT_VERIFIED',
  })
  @ApiResponse({
    status: 404,
    description:
      'GOOGLE_ACCOUNT_NOT_REGISTERED — chưa có tài khoản, gọi lại cùng idToken kèm role',
  })
  @ApiResponse({ status: 403, description: 'ACCOUNT_SUSPENDED' })
  @ApiResponse({
    status: 503,
    description:
      'GOOGLE_AUTH_NOT_CONFIGURED (thiếu GOOGLE_CLIENT_IDS) | GOOGLE_AUTH_UNAVAILABLE (không kết nối được Google — thử lại sau)',
  })
  google(
    @Body() dto: GoogleLoginDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<GoogleAuthResponseDto> {
    return this.auth.loginWithGoogle(dto, userAgent);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Làm mới token bằng refresh token (có xoay token)' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({
    status: 401,
    description: 'INVALID_REFRESH_TOKEN | REFRESH_TOKEN_REUSED',
  })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Headers('user-agent') userAgent?: string,
  ): Promise<AuthTokensResponseDto> {
    return this.auth.refresh(dto, userAgent);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Đăng xuất — có refreshToken thì thu hồi 1 thiết bị, bỏ trống thì mọi thiết bị',
  })
  @ApiResponse({ status: 200, type: LogoutResponseDto })
  logout(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: LogoutDto,
  ): Promise<LogoutResponseDto> {
    return this.auth.logout(user, dto);
  }
}
