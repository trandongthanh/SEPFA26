import { Body, Controller, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { BroadcastNotificationDto } from './dto/broadcast-notification.dto';
import { BroadcastNotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('admin-notifications')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/notifications')
export class AdminNotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Post('broadcast')
  @ApiOperation({
    summary:
      'Admin phát thông báo hệ thống tới tất cả / theo vai trò / danh sách tài khoản',
  })
  @ApiResponse({ status: 201, type: BroadcastNotificationResponseDto })
  @ApiResponse({ status: 400, description: 'TARGET_ACCOUNTS_REQUIRED' })
  broadcast(@Body() dto: BroadcastNotificationDto) {
    return this.notificationsService.broadcast(dto);
  }
}
