import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
import { RegisterProviderDto } from './dto/register-provider.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import {
  AuthTokensResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(201)
  @ApiOperation({ summary: 'Đăng ký tài khoản CUSTOMER hoặc PROVIDER' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'EMAIL_EXISTS — email đã tồn tại' })
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('register-provider')
  @HttpCode(201)
  @ApiOperation({ summary: 'Đăng ký riêng dành cho Provider kèm tạo hồ sơ provider_profiles PENDING' })
  @ApiResponse({ status: 201, type: RegisterResponseDto })
  @ApiResponse({ status: 409, description: 'EMAIL_EXISTS — email đã tồn tại' })
  registerProvider(@Body() dto: RegisterProviderDto): Promise<RegisterResponseDto> {
    return this.auth.registerProvider(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đăng nhập, trả về access + refresh token' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'INVALID_CREDENTIALS' })
  @ApiResponse({
    status: 403,
    description: 'ACCOUNT_SUSPENDED (bị khoá) hoặc ACCOUNT_INACTIVE (chưa kích hoạt)',
  })
  login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    return this.auth.login(dto, req.headers['user-agent']);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Làm mới token bằng refresh token (có xoay token)' })
  @ApiResponse({ status: 200, type: AuthTokensResponseDto })
  @ApiResponse({ status: 401, description: 'INVALID_REFRESH_TOKEN' })
  refresh(
    @Body() dto: RefreshTokenDto,
    @Req() req: Request,
  ): Promise<AuthTokensResponseDto> {
    return this.auth.refresh(dto, req.headers['user-agent']);
  }

  @Post('logout')
  @HttpCode(200)
  @ApiBearerAuth()
  @ApiOperation({
    summary:
      'Đăng xuất — có refreshToken thì thu hồi 1 thiết bị, bỏ trống thì thu hồi mọi thiết bị',
  })
  @ApiResponse({ status: 200, type: LogoutResponseDto })
  logout(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: LogoutDto,
  ): Promise<LogoutResponseDto> {
    return this.auth.logout(user, dto);
  }
}
