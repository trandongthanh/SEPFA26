import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';

import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';

import { VideoCallsService } from './video-calls.service';
import { CreateCallDto } from './dto/create-call.dto';
import { TokenResponseDto } from './dto/token-response.dto';
import { CreateCallResponseDto } from './dto/create-call-response.dto';
import { CallInfoResponseDto } from './dto/call-info-response.dto';
import { JoinCallResponseDto } from './dto/join-call-response.dto';

@ApiTags('video-calls')
@ApiBearerAuth()
@Controller('video-calls')
export class VideoCallsController {
  constructor(private readonly videoCallsService: VideoCallsService) {}

  @Post('token')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate a GetStream user token for the current account.',
  })
  @ApiResponse({ status: HttpStatus.OK, type: TokenResponseDto })
  async getToken(
    @CurrentUser() user: CurrentUserData,
  ): Promise<TokenResponseDto> {
    return this.videoCallsService.generateToken(user.accountId);
  }

  @Post()
  @ApiOperation({
    summary: 'Create a new video call owned by the current account.',
  })
  @ApiResponse({ status: HttpStatus.CREATED, type: CreateCallResponseDto })
  async createCall(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCallDto,
  ): Promise<CreateCallResponseDto> {
    return this.videoCallsService.createCall(user.accountId, dto);
  }

  @Get('orders/:orderId/current')
  @ApiOperation({ summary: 'Get the currently open video room for an order.' })
  async getCurrentOrderCall(
    @Param('orderId') orderId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.videoCallsService.getCurrentOrderCall(orderId, user.accountId);
  }

  @Get(':callId')
  @ApiOperation({ summary: 'Get call metadata (creator, current members).' })
  @ApiResponse({ status: HttpStatus.OK, type: CallInfoResponseDto })
  async getCall(
    @Param('callId') callId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<CallInfoResponseDto> {
    return this.videoCallsService.getCallInfo(callId, user.accountId);
  }

  @Post(':callId/join')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Join an existing call as the current account.' })
  @ApiResponse({ status: HttpStatus.OK, type: JoinCallResponseDto })
  async joinCall(
    @Param('callId') callId: string,
    @CurrentUser() user: CurrentUserData,
  ): Promise<JoinCallResponseDto> {
    return this.videoCallsService.joinCall(callId, user.accountId);
  }

  @Post(':callId/leave')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Record that the current participant left a video room.' })
  async leaveCall(
    @Param('callId') callId: string,
    @CurrentUser() user: CurrentUserData,
  ) {
    return this.videoCallsService.leaveCall(callId, user.accountId);
  }
}
