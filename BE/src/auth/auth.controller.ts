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
import { Throttle } from '@nestjs/throttler';
import { RATE_LIMIT_WINDOW_MS } from '../common/throttle';
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
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import {
  AuthTokensResponseDto,
  ForgotPasswordResponseDto,
  GoogleAuthResponseDto,
  LogoutResponseDto,
  RegisterResponseDto,
} from './dto/auth-response.dto';

// Rate limit riêng cho route public dễ bị dò/spam (cửa sổ 1 phút, xem common/throttle.ts):
// - ip: mọi request từ 1 IP (chống 1 máy spam / thử nhiều email);
// - account: theo IP + email trong body — chặn dò 1 email mà không chặn người khác chung IP
//   (cả phòng chung Wi-Fi khi demo). Chỉ đếm khi body có email.
// Vượt → 429 ThrottlerException.
const throttle = (limits: { ip: number; account?: number }) =>
  Throttle({
    default: { limit: limits.ip, ttl: RATE_LIMIT_WINDOW_MS },
    ...(limits.account !== undefined && {
      account: { limit: limits.account, ttl: RATE_LIMIT_WINDOW_MS },
    }),
  });

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
  // Chống spam tạo account.
  @throttle({ ip: 30, account: 5 })
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
  // Chống dò mật khẩu (brute-force).
  @throttle({ ip: 30, account: 5 })
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
  // Mỗi lần gọi tải/kiểm chữ ký Google; lần đầu có thể gửi mail.
  @throttle({ ip: 10 })
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
  // App tự gọi khi access token hết hạn — nới hơn login.
  @throttle({ ip: 30 })
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

  @Public()
  @Post('forgot-password')
  // Mỗi lần gọi gửi 1 mail — chặn spam hộp thư người khác.
  @throttle({ ip: 10, account: 3 })
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Quên mật khẩu — gửi link đặt lại qua mail (hạn 30 phút, dùng 1 lần). LUÔN 200, kể cả email không tồn tại',
  })
  @ApiResponse({ status: 200, type: ForgotPasswordResponseDto })
  forgotPassword(
    @Body() dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    return this.auth.forgotPassword(dto);
  }

  @Public()
  @Post('reset-password')
  // Chống dò token.
  @throttle({ ip: 5 })
  @HttpCode(204)
  @ApiOperation({
    summary:
      'Đặt lại mật khẩu bằng token trong link mail — thành công thì MỌI phiên bị đăng xuất',
  })
  @ApiResponse({ status: 204 })
  @ApiResponse({
    status: 400,
    description: 'RESET_TOKEN_INVALID (sai / hết hạn / đã dùng)',
  })
  resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
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
