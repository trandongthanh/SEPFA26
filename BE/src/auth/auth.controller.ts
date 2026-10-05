import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Public } from './decorators/public.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import type { CurrentUserData } from './types/current-user.type';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { RegisterWithEkycDto } from './dto/register-with-ekyc.dto';
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
  @Post('register-with-ekyc')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Đăng ký tài khoản tự động lồng eKYC (Check trùng Email + CCCD, tự động ACTIVE/APPROVED)',
    description:
      'Đăng ký tài khoản kèm xác thực eKYC trọn gói. Nhận thông tin đăng ký + ảnh mặt trước CCCD + ảnh selfie. ' +
      'AI tự động bóc tách thông tin, check trùng email, check trùng số CCCD, kiểm tra thẻ giả và so khớp khuôn mặt. ' +
      'Thành công sẽ tự động kích hoạt tài khoản (status: ACTIVE, hồ sơ: APPROVED), không cần Admin duyệt tay!',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password', 'cccdFront', 'selfie'],
      properties: {
        email: { type: 'string', format: 'email', example: 'customer@lancarehub.vn' },
        password: { type: 'string', example: 'MatKhau123@' },
        fullName: { type: 'string', example: 'Nguyễn Văn Lan (tuỳ chọn - AI tự đọc)' },
        role: { type: 'string', enum: ['CUSTOMER', 'PROVIDER'], default: 'CUSTOMER' },
        phone: { type: 'string', example: '0901234567' },
        cccdFront: { type: 'string', format: 'binary', description: 'Ảnh mặt trước CCCD (bắt buộc)' },
        selfie: { type: 'string', format: 'binary', description: 'Ảnh selfie khuôn mặt thật (bắt buộc)' },
        cccdBack: { type: 'string', format: 'binary', description: 'Ảnh mặt sau CCCD (tuỳ chọn)' },
      },
    },
  })
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'cccdFront', maxCount: 1 },
        { name: 'selfie', maxCount: 1 },
        { name: 'cccdBack', maxCount: 1 },
      ],
      {
        storage: memoryStorage(),
        limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB (hỗ trợ camera điện thoại phân giải cao)
      },
    ),
  )
  async registerWithEkyc(
    @Body() dto: RegisterWithEkycDto,
    @UploadedFiles()
    files: {
      cccdFront?: Express.Multer.File[];
      selfie?: Express.Multer.File[];
      cccdBack?: Express.Multer.File[];
    },
    @Headers('user-agent') userAgent?: string,
  ) {
    if (!files?.cccdFront?.[0]) {
      throw new BadRequestException('Vui lòng tải lên ảnh mặt trước CCCD (field: cccdFront).');
    }
    if (!files?.selfie?.[0]) {
      throw new BadRequestException('Vui lòng tải lên ảnh selfie khuôn mặt (field: selfie).');
    }
    return this.auth.registerWithEkyc(
      dto,
      {
        cccdFront: files.cccdFront[0],
        selfie: files.selfie[0],
        cccdBack: files.cccdBack?.[0],
      },
      userAgent,
    );
  }

  @Public()
  @Post('register')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Đăng ký tài khoản cơ bản (status PENDING - khuyến khích dùng /register-with-ekyc để tự động kích hoạt)',
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
