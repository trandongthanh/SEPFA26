import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { AddInitialPhotoDto } from './dto/add-initial-photo.dto';
import { AssessPlantDto } from './dto/assess-plant.dto';
import { CompleteHandoverDto } from './dto/complete-handover.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { RespondNegotiationDto } from './dto/respond-negotiation.dto';
import { HandoverService } from './handover.service';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly handoverService: HandoverService,
  ) {}

  @Roles('CUSTOMER')
  @Post()
  @ApiOperation({ summary: 'Khách tạo đơn nháp (DRAFT) — server tự tính phí' })
  createOrder(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateOrderDto,
  ) {
    return this.ordersService.createOrder(user.accountId, dto);
  }

  @Roles('CUSTOMER')
  @Post(':orderId/plants/:plantId/initial-photos')
  @ApiOperation({
    summary: 'Khách thêm ảnh hiện trạng cho từng cây (đơn DRAFT)',
  })
  addInitialPhoto(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('plantId', ParseUUIDPipe) plantId: string,
    @Body() dto: AddInitialPhotoDto,
  ) {
    return this.ordersService.addInitialPhoto(
      user.accountId,
      orderId,
      plantId,
      dto,
    );
  }

  @Roles('CUSTOMER')
  @Post(':orderId/submit')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Khách gửi đơn cho nhà vườn (DRAFT → PENDING_PROVIDER)',
  })
  submitOrder(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ordersService.submitOrder(user.accountId, orderId);
  }

  @Roles('PROVIDER')
  @Post(':orderId/negotiation/respond')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vườn quyết đơn: ACCEPT → AGREEMENT_PENDING / REJECT → REJECTED',
  })
  respondNegotiation(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: RespondNegotiationDto,
  ) {
    return this.ordersService.respondNegotiation(user.accountId, orderId, dto);
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Post(':orderId/agreement/sign')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Ký hợp đồng online (vai từ JWT) — đủ 2 chữ ký → AWAITING_PAYMENT',
  })
  signAgreement(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Ip() ip: string,
  ) {
    return this.ordersService.signAgreement(
      user.accountId,
      user.role,
      orderId,
      ip,
    );
  }

  @Roles('PROVIDER')
  @Post(':orderId/handover/start')
  @ApiOperation({
    summary: 'Vườn mở phiên bàn giao (PAID → HANDOVER_IN_PROGRESS)',
  })
  startHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.handoverService.startHandover(user.accountId, orderId);
  }

  @Roles('PROVIDER')
  @Post(':orderId/handover/plants/:plantId/assess')
  @ApiOperation({
    summary:
      'Vườn thẩm định từng cây (ảnh bắt buộc, re-assess được trước complete)',
  })
  assessPlant(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('plantId', ParseUUIDPipe) plantId: string,
    @Body() dto: AssessPlantDto,
  ) {
    return this.handoverService.assessPlant(
      user.accountId,
      orderId,
      plantId,
      dto,
    );
  }

  @Roles('PROVIDER')
  @Post(':orderId/handover/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vườn chốt thẩm định (→ HANDOVER_AWAITING_CONFIRM, hẹn khách 48h)',
  })
  completeHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CompleteHandoverDto,
  ) {
    return this.handoverService.completeHandover(user.accountId, orderId, dto);
  }

  @Roles('CUSTOMER')
  @Post(':orderId/handover/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Khách xác nhận bàn giao (→ IN_CARE) — khóa giá chính thức',
  })
  confirmHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Ip() ip: string,
  ) {
    return this.handoverService.confirmHandover(user.accountId, orderId, ip);
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Get()
  @ApiOperation({ summary: 'Danh sách đơn phía mình (khách/vườn tự lọc)' })
  listOrders(
    @CurrentUser() user: CurrentUserData,
    @Query() query: QueryOrderDto,
  ) {
    return this.ordersService.listOrders(user.accountId, user.role, query);
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Get(':orderId')
  @ApiOperation({ summary: 'Chi tiết đơn kèm cây + ảnh + negotiation' })
  getOrderDetail(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ordersService.getOrderDetail(
      user.accountId,
      user.role,
      orderId,
    );
  }
}
