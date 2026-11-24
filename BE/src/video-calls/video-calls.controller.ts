import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import { CreateVideoCallDto } from './dto/create-video-call.dto';
import { OrderIdQueryDto } from './dto/order-id-query.dto';
import {
  ActiveVideoCallResponseDto,
  VideoCallResponseDto,
  VideoCallSessionResponseDto,
} from './dto/video-call-response.dto';
import { VideoCallsService } from './video-calls.service';

// Bản chốt §5.1 — cuộc gọi video 1-1 giữa khách và provider của một đơn.
@ApiTags('video-calls')
@ApiBearerAuth()
@Controller('video-calls')
export class VideoCallsController {
  constructor(private readonly videoCalls: VideoCallsService) {}

  @Post()
  @ApiOperation({
    summary: 'Gọi video bên còn lại của đơn (bắt đầu đổ chuông)',
  })
  @ApiResponse({ status: 201, type: VideoCallSessionResponseDto })
  @ApiResponse({ status: 400, description: 'orderId không phải uuid' })
  @ApiResponse({
    status: 404,
    description: 'ORDER_NOT_FOUND (đơn không có hoặc không phải bên của đơn)',
  })
  @ApiResponse({
    status: 409,
    description:
      'ORDER_NOT_CALLABLE | VIDEO_CALL_IN_PROGRESS | CALLER_BUSY | CALLEE_BUSY',
  })
  @ApiResponse({ status: 502, description: 'VIDEO_PROVIDER_UNAVAILABLE' })
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateVideoCallDto,
  ): Promise<VideoCallSessionResponseDto> {
    return this.videoCalls.create(user.accountId, dto.orderId);
  }

  @Get('active')
  @ApiOperation({
    summary:
      'Cuộc gọi đang diễn ra của đơn (mở lại app, lỡ sự kiện socket) — null nếu không có',
  })
  @ApiResponse({ status: 200, type: ActiveVideoCallResponseDto })
  @ApiResponse({ status: 400, description: 'orderId không phải uuid' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  getActive(
    @CurrentUser() user: CurrentUserData,
    @Query() query: OrderIdQueryDto,
  ): Promise<ActiveVideoCallResponseDto> {
    return this.videoCalls.getActive(user.accountId, query.orderId);
  }

  @Get()
  @ApiOperation({
    summary: 'Lịch sử cuộc gọi của đơn (mới nhất trước, tối đa 50)',
  })
  @ApiResponse({ status: 200, type: [VideoCallResponseDto] })
  @ApiResponse({ status: 400, description: 'orderId không phải uuid' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  listHistory(
    @CurrentUser() user: CurrentUserData,
    @Query() query: OrderIdQueryDto,
  ): Promise<VideoCallResponseDto[]> {
    return this.videoCalls.listHistory(user.accountId, query.orderId);
  }

  @Post(':id/join')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Nghe cuộc gọi (đang đổ chuông) / vào lại, chuyển máy (đang nói) — máy vào sau giữ cuộc gọi',
  })
  @ApiResponse({ status: 200, type: VideoCallSessionResponseDto })
  @ApiResponse({ status: 400, description: 'id không phải uuid' })
  @ApiResponse({
    status: 404,
    description:
      'VIDEO_CALL_NOT_FOUND (không có hoặc không phải bên của cuộc gọi)',
  })
  @ApiResponse({
    status: 409,
    description: 'VIDEO_CALL_ENDED | ORDER_NOT_CALLABLE',
  })
  join(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoCallSessionResponseDto> {
    return this.videoCalls.join(user.accountId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  @ApiOperation({ summary: 'Người nhận từ chối cuộc gọi đang đổ chuông' })
  @ApiResponse({ status: 200, type: VideoCallResponseDto })
  @ApiResponse({ status: 400, description: 'id không phải uuid' })
  @ApiResponse({ status: 403, description: 'ONLY_CALLEE_CAN_DECLINE' })
  @ApiResponse({ status: 404, description: 'VIDEO_CALL_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'VIDEO_CALL_NOT_RINGING' })
  decline(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoCallResponseDto> {
    return this.videoCalls.decline(user.accountId, id);
  }

  @Post(':id/end')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Hủy (đang đổ chuông) / cúp (đang nói); đã kết thúc thì trả nguyên trạng',
  })
  @ApiResponse({ status: 200, type: VideoCallResponseDto })
  @ApiResponse({ status: 400, description: 'id không phải uuid' })
  @ApiResponse({ status: 404, description: 'VIDEO_CALL_NOT_FOUND' })
  end(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<VideoCallResponseDto> {
    return this.videoCalls.end(user.accountId, id);
  }
}
