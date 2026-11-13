import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { AddonsService } from './addons.service';
import { CompleteAddonDto } from './dto/complete-addon.dto';
import { CreateAddonDto } from './dto/create-addon.dto';
import { RespondAddonDto } from './dto/respond-addon.dto';

// Add-on của một đơn. Route lấy QR trả tiền add-on nằm ở payments.controller.ts.
@ApiTags('addons')
@ApiBearerAuth()
@ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
@Controller('orders/:orderId/addons')
export class AddonsController {
  constructor(private readonly addonsService: AddonsService) {}

  @Roles('PROVIDER')
  @Post()
  @ApiOperation({
    summary:
      'Vườn đề xuất add-on (việc phát sinh ngoài gói) cho đơn đang chăm — khách có 48 giờ để trả lời',
  })
  @ApiResponse({
    status: 400,
    description:
      'ADDON_PRICE_OUT_OF_RANGE (giá ngoài 1.000–50.000.000) | PLANT_NOT_IN_ORDER | thiếu title/reason, photoUrls không phải 1–5 link https',
  })
  @ApiResponse({ status: 403, description: 'PROFILE_NOT_APPROVED' })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_STATE_TRANSITION (đơn không ở IN_CARE) | ADDON_LIMIT_REACHED (đã có 3 đề xuất đang mở)',
  })
  create(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateAddonDto,
  ) {
    return this.addonsService.create(user.accountId, orderId, dto);
  }

  @Roles('CUSTOMER', 'PROVIDER', 'ADMIN')
  @Get()
  @ApiOperation({
    summary:
      'Khách / vườn của đơn (hoặc admin) xem mọi đề xuất add-on, mới nhất trước',
  })
  list(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.addonsService.list(user.accountId, user.role, orderId);
  }

  @Roles('CUSTOMER')
  @Post(':addonId/respond')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách đồng ý (rồi có 24 giờ để chuyển khoản) hoặc từ chối đề xuất add-on',
  })
  @ApiResponse({ status: 404, description: 'ADDON_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'ADDON_EXPIRED (quá 48 giờ) | ADDON_INVALID_STATE (đã trả lời rồi)',
  })
  respond(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @Body() dto: RespondAddonDto,
  ) {
    return this.addonsService.respond(user.accountId, orderId, addonId, dto);
  }

  @Roles('PROVIDER')
  @Post(':addonId/complete')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Vườn báo đã làm xong add-on (khách đã trả tiền) — báo cáo gồm ảnh sau khi làm, mô tả việc đã làm, tình trạng cây',
  })
  @ApiResponse({
    status: 400,
    description:
      'ADDON_PLANT_HEALTH_REQUIRED (add-on gắn một cây mà thiếu plantHealthAfter) | ADDON_PLANT_HEALTH_NOT_ALLOWED (add-on cho cả đơn mà gửi plantHealthAfter) | thiếu note hoặc note dưới 10 ký tự, photoUrls không phải 1–5 link https',
  })
  @ApiResponse({ status: 403, description: 'PROFILE_NOT_APPROVED' })
  @ApiResponse({ status: 404, description: 'ADDON_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'ADDON_INVALID_STATE (khách chưa trả tiền hoặc đã báo xong rồi) | ADDON_EXPIRED',
  })
  complete(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('addonId', ParseUUIDPipe) addonId: string,
    @Body() dto: CompleteAddonDto,
  ) {
    return this.addonsService.complete(user.accountId, orderId, addonId, dto);
  }
}
