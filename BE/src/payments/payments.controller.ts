import {
  Controller,
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

  @Roles('CUSTOMER')
  @Post(':orderId/addons/:addonId/payment/qr')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách lấy mã VietQR trả tiền một add-on đã đồng ý (trong 24 giờ kể từ lúc đồng ý)',
  })
  @ApiResponse({
    status: 404,
    description: 'ORDER_NOT_FOUND | ADDON_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'ADDON_EXPIRED (quá hạn trả tiền) | ADDON_INVALID_STATE (chưa đồng ý hoặc đã trả rồi)',
  })
  getAddonPaymentQr(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('addonId', ParseUUIDPipe) addonId: string,
  ) {
    return this.paymentsService.getAddonPaymentQr(
      user.accountId,
      orderId,
      addonId,
    );
  }

  @Roles('PROVIDER')
  @Post(':orderId/security-deposit/qr')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Vườn lấy mã VietQR nộp tiền bảo đảm lúc nhận cây (trong 2 giờ kể từ lúc khách đồng ý biên bản)',
  })
  @ApiResponse({ status: 403, description: 'PROFILE_NOT_APPROVED' })
  @ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'SECURITY_DEPOSIT_NOT_PENDING (khách chưa đồng ý biên bản, khoản đã nộp hoặc đã huỷ) | SECURITY_DEPOSIT_EXPIRED (khoản còn chờ nhưng đã quá hạn 2 giờ)',
  })
  getSecurityDepositQr(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.paymentsService.getSecurityDepositQr(user.accountId, orderId);
  }
}
