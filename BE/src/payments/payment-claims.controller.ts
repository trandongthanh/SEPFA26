import {
  Body,
  Controller,
  Get,
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
import { CreatePaymentClaimDto } from './dto/create-payment-claim.dto';
import { PaymentClaimsService } from './payment-claims.service';

@ApiTags('payment-claims')
@ApiBearerAuth()
@Roles('CUSTOMER', 'PROVIDER')
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('orders')
export class PaymentClaimsController {
  constructor(private readonly claimsService: PaymentClaimsService) {}

  @Post(':orderId/payment-claims')
  @ApiOperation({
    summary:
      'Khách / vườn của đơn nộp phiếu báo đã chuyển tiền nhưng chưa được ghi nhận, kèm 1–3 ảnh sao kê (mọi trạng thái đơn)',
  })
  @ApiResponse({ status: 201, description: 'Phiếu OPEN kèm ảnh' })
  @ApiResponse({
    status: 400,
    description:
      'Validation: photos 0 hoặc hơn 3 ảnh, amount không phải số nguyên > 0, note quá 500 ký tự, transferredAt không phải ISO 8601',
  })
  @ApiResponse({
    status: 404,
    description:
      'ORDER_NOT_FOUND (không có đơn hoặc người gọi không thuộc đơn)',
  })
  @ApiResponse({
    status: 409,
    description: 'PAYMENT_CLAIM_LIMIT_REACHED (bên này đã có 3 phiếu đang mở)',
  })
  create(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreatePaymentClaimDto,
  ) {
    return this.claimsService.create(user.accountId, orderId, dto);
  }

  @Get(':orderId/payment-claims')
  @ApiOperation({
    summary:
      'Khách / vườn xem phiếu báo đã chuyển tiền của chính mình trên đơn (mới nhất lên đầu, kèm trạng thái hoàn và biên lai)',
  })
  @ApiResponse({
    status: 404,
    description:
      'ORDER_NOT_FOUND (không có đơn hoặc người gọi không thuộc đơn)',
  })
  list(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.claimsService.listForOrder(user.accountId, orderId);
  }
}
