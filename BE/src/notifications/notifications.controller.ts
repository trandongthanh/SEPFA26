import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Query,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import {
  DeleteNotificationResponseDto,
  DeleteReadNotificationsResponseDto,
  MarkAllReadResponseDto,
  MarkNotificationReadResponseDto,
  NotificationListResponseDto,
  NotificationResponseDto,
  UnreadCountResponseDto,
} from './dto/notification-response.dto';
import { QueryNotificationsDto } from './dto/query-notifications.dto';
import { NotificationsService } from './notifications.service';

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  // Route tĩnh đặt TRƯỚC route :id để không bị hiểu là UUID.

  @Get('unread-count')
  @ApiOperation({ summary: 'Đếm số thông báo chưa đọc của tài khoản hiện tại' })
  @ApiResponse({ status: 200, type: UnreadCountResponseDto })
  countUnread(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.countUnread(user.accountId);
  }

  @Get()
  @ApiOperation({
    summary: 'Danh sách thông báo của tài khoản hiện tại (phân trang, lọc)',
  })
  @ApiResponse({ status: 200, type: NotificationListResponseDto })
  listForAccount(
    @CurrentUser() user: CurrentUserData,
    @Query() query: QueryNotificationsDto,
  ) {
    return this.notificationsService.listForAccount(user.accountId, query);
  }

  @Patch('read-all')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đánh dấu tất cả thông báo chưa đọc là đã đọc' })
  @ApiResponse({ status: 200, type: MarkAllReadResponseDto })
  markAllAsRead(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.markAllAsRead(user.accountId);
  }

  @Delete('read')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Xoá toàn bộ thông báo đã đọc của tài khoản hiện tại',
  })
  @ApiResponse({ status: 200, type: DeleteReadNotificationsResponseDto })
  deleteRead(@CurrentUser() user: CurrentUserData) {
    return this.notificationsService.deleteRead(user.accountId);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Xem chi tiết một thông báo thuộc tài khoản hiện tại',
  })
  @ApiResponse({ status: 200, type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND' })
  getById(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.getById(user.accountId, id);
  }

  @Patch(':id/read')
  @HttpCode(200)
  @ApiOperation({ summary: 'Đánh dấu một thông báo là đã đọc' })
  @ApiResponse({ status: 200, type: MarkNotificationReadResponseDto })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND' })
  markAsRead(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.markAsRead(user.accountId, id);
  }

  @Delete(':id')
  @HttpCode(200)
  @ApiOperation({ summary: 'Xoá một thông báo thuộc tài khoản hiện tại' })
  @ApiResponse({ status: 200, type: DeleteNotificationResponseDto })
  @ApiResponse({ status: 404, description: 'NOTIFICATION_NOT_FOUND' })
  deleteOne(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.notificationsService.deleteOne(user.accountId, id);
  }
}
