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
import { Roles } from '../auth/decorators/roles.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { QueryPaymentClaimDto } from './dto/query-payment-claim.dto';
import { RejectPaymentClaimDto } from './dto/reject-payment-claim.dto';
import { PaymentClaimsService } from './payment-claims.service';

@ApiTags('admin-payment-claims')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/payment-claims')
export class AdminPaymentClaimsController {
  constructor(private readonly claimsService: PaymentClaimsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin xem phiếu báo đã chuyển tiền (lọc trạng thái, số tiền khai), mới nhất lên đầu, kèm ảnh, mã đơn, người nộp',
  })
  @ApiResponse({
    status: 400,
    description:
      'status không phải OPEN/RESOLVED/REJECTED, amount không phải số nguyên > 0, page < 1, limit ngoài 1–50',
  })
  list(@Query() query: QueryPaymentClaimDto) {
    return this.claimsService.listForAdmin(query);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Admin từ chối phiếu báo đã chuyển tiền kèm lý do (chỉ phiếu đang mở; người nộp nộp lại phiếu mới được)',
  })
  @ApiResponse({ status: 200, description: 'Phiếu REJECTED kèm rejectReason' })
  @ApiResponse({
    status: 400,
    description: 'id không phải UUID, reason thiếu hoặc ngoài 5–500 ký tự',
  })
  @ApiResponse({ status: 404, description: 'PAYMENT_CLAIM_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'PAYMENT_CLAIM_NOT_OPEN (phiếu đã được hoàn hoặc đã bị từ chối)',
  })
  reject(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectPaymentClaimDto,
  ) {
    return this.claimsService.reject(user.accountId, id, dto);
  }
}
