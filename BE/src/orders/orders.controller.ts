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
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { AddInitialPhotoDto } from './dto/add-initial-photo.dto';
import { AssessPlantDto } from './dto/assess-plant.dto';
import { AssessReturnPlantDto } from './dto/assess-return-plant.dto';
import { CancelHandoverDto } from './dto/cancel-handover.dto';
import { CancelReturnDto } from './dto/cancel-return.dto';
import { CompleteHandoverDto } from './dto/complete-handover.dto';
import { ConfirmHandoverDto } from './dto/confirm-handover.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { DeclineHandoverDto } from './dto/decline-handover.dto';
import { QueryOrderDto } from './dto/query-order.dto';
import { RespondNegotiationDto } from './dto/respond-negotiation.dto';
import { ContractTemplateService } from './contract-template.service';
import { HandoverService } from './handover.service';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly handoverService: HandoverService,
    private readonly contractTemplate: ContractTemplateService,
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
  @ApiResponse({
    status: 403,
    description:
      'PROFILE_NOT_APPROVED | PROVIDER_IDENTITY_INCOMPLETE (ACCEPT khi vườn chưa khai SĐT/số CCCD)',
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
      'Vườn thẩm định từng cây: ACCEPT | ACCEPT_HIGH_RISK | REJECT (ảnh bắt buộc, re-assess được trước complete)',
  })
  @ApiResponse({
    status: 400,
    description:
      'HIGH_RISK_FLAG_MISMATCH | decision không hợp lệ (ADJUST đã bỏ) | thiếu ảnh',
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
    summary:
      'Vườn chốt thẩm định (→ HANDOVER_AWAITING_CONFIRM): giá công = giá gói × số cây nhận, trả kèm mức đền từng cây và tổng tiền bảo đảm',
  })
  @ApiResponse({
    status: 400,
    description:
      'UNASSESSED_PLANTS | ALL_PLANTS_REJECTED | body có field lạ (proposedFinalTotal đã bỏ)',
  })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  completeHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    // Body không còn field nào; giữ DTO rỗng để field lạ (proposedFinalTotal cũ) bị 400.
    @Body() _dto: CompleteHandoverDto,
  ) {
    return this.handoverService.completeHandover(user.accountId, orderId);
  }

  @Roles('CUSTOMER')
  @Post(':orderId/handover/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách đồng ý biên bản nhận cây (có thể kèm ý kiến phản đối + ảnh) → phiên chờ vườn nộp tiền bảo đảm trong 2 giờ; đơn chỉ sang IN_CARE khi tiền bảo đảm về',
  })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description: 'INVALID_STATE_TRANSITION (sai chặng hoặc bấm lần 2)',
  })
  confirmHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: ConfirmHandoverDto,
    @Ip() ip: string,
  ) {
    return this.handoverService.confirmHandover(
      user.accountId,
      orderId,
      dto,
      ip,
    );
  }

  @Roles('CUSTOMER')
  @Post(':orderId/handover/decline')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách không giao cây sau khi xem biên bản (→ CANCELLED): hoàn giá gói + 6%, vườn giữ phí lấy cây',
  })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'INVALID_STATE_TRANSITION (sai chặng, hoặc khách đã đồng ý biên bản và vườn đang chờ nộp tiền bảo đảm)',
  })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  declineHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: DeclineHandoverDto,
  ) {
    return this.handoverService.declineHandover(user.accountId, orderId, dto);
  }

  @Roles('PROVIDER')
  @Post(':orderId/handover/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Vườn huỷ vì không nộp tiền bảo đảm (→ CANCELLED): hoàn khách 100% kể cả phí lấy cây',
  })
  @ApiResponse({ status: 403, description: 'PROFILE_NOT_APPROVED' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'SECURITY_DEPOSIT_NOT_PENDING (khách chưa đồng ý biên bản, khoản đã nộp hoặc đã huỷ)',
  })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  cancelHandover(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelHandoverDto,
  ) {
    return this.handoverService.cancelHandover(user.accountId, orderId, dto);
  }

  // ---- Trả cây (IN_CARE → COMPLETED) ----

  @Roles('PROVIDER')
  @Post(':orderId/return/start')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Vườn bắt đầu trả cây khi đã hết hạn chăm (IN_CARE → RETURN_IN_PROGRESS)',
  })
  @ApiResponse({
    status: 409,
    description:
      'CARE_NOT_DUE | INVALID_STATE_TRANSITION | ADDON_OPEN (còn add-on khách đã trả tiền mà vườn chưa báo xong)',
  })
  @ApiResponse({ status: 403, description: 'PROFILE_NOT_APPROVED' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  startReturn(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.handoverService.startReturn(user.accountId, orderId);
  }

  @Roles('PROVIDER')
  @Post(':orderId/return/plants/:plantId/assess')
  @ApiOperation({
    summary: 'Vườn ghi tình trạng từng cây lúc trả (ảnh bắt buộc)',
  })
  @ApiResponse({ status: 400, description: 'PLANT_NOT_IN_CARE' })
  @ApiResponse({
    status: 404,
    description: 'ORDER_NOT_FOUND | PLANT_NOT_FOUND',
  })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  assessReturnPlant(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('plantId', ParseUUIDPipe) plantId: string,
    @Body() dto: AssessReturnPlantDto,
  ) {
    return this.handoverService.assessReturnPlant(
      user.accountId,
      orderId,
      plantId,
      dto,
    );
  }

  @Roles('PROVIDER')
  @Post(':orderId/return/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vườn chốt trả cây (→ RETURN_AWAITING_CONFIRM, hẹn khách 48h)',
  })
  @ApiResponse({ status: 400, description: 'UNASSESSED_PLANTS' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  completeReturn(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.handoverService.completeReturn(user.accountId, orderId);
  }

  @Roles('PROVIDER')
  @Post(':orderId/return/cancel')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Vườn huỷ phiên trả để hẹn lại (RETURN_IN_PROGRESS → IN_CARE)',
  })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  cancelReturn(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CancelReturnDto,
  ) {
    return this.handoverService.cancelReturn(user.accountId, orderId, dto);
  }

  @Roles('CUSTOMER')
  @Post(':orderId/return/confirm')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách xác nhận đã nhận lại cây (RETURN_AWAITING_CONFIRM → COMPLETED), chia tiền + tạo lệnh chi cho vườn; settlement trả về chỉ gồm phần của khách',
  })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'INVALID_STATE_TRANSITION' })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  confirmReturn(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.handoverService.confirmReturn(user.accountId, orderId);
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Get(':orderId/agreement/contract')
  @ApiOperation({
    summary:
      'Xem hợp đồng điện tử đầy đủ (điều khoản, cây, bồi thường 120%, chữ ký)',
  })
  getContract(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.ordersService.getContractDetail(
      user.accountId,
      user.role,
      orderId,
    );
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
