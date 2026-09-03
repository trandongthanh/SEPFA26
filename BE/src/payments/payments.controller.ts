import {
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { PaymentsService } from './payments.service';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('orders')
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Roles('CUSTOMER')
  @Post(':orderId/payment/qr')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Khách lấy mã VietQR trả tiền đơn (đơn AWAITING_PAYMENT)',
  })
  getPaymentQr(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.paymentsService.getPaymentQr(user.accountId, orderId);
  }
}
