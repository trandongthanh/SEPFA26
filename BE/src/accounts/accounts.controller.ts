import { Controller, Get, Patch, Body, HttpCode, HttpStatus } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { AccountsService } from './accounts.service';
import { AccountResponseDto } from './dto/account-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

@ApiTags('accounts')
@ApiBearerAuth()
@Controller('accounts')
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Thông tin tài khoản đang đăng nhập' })
  @ApiResponse({ status: 200, type: AccountResponseDto })
  @ApiResponse({ status: 401, description: 'Chưa đăng nhập / token sai' })
  me(@CurrentUser() user: CurrentUserData): Promise<AccountResponseDto> {
    return this.accounts.getProfile(user.accountId);
  }

  @Patch('me/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Đổi mật khẩu tài khoản đang đăng nhập' })
  @ApiResponse({ status: 204, description: 'Đổi mật khẩu thành công' })
  @ApiResponse({ status: 400, description: 'Mật khẩu hiện tại không đúng' })
  changePassword(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: ChangePasswordDto,
  ): Promise<void> {
    return this.accounts.changePassword(user.accountId, dto.currentPassword, dto.newPassword);
  }
}
