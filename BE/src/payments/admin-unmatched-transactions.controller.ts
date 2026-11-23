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
import { QueryUnmatchedTransactionDto } from './dto/query-unmatched-transaction.dto';
import { RefundUnmatchedTransactionDto } from './dto/refund-unmatched-transaction.dto';
import { UnmatchedTransactionsService } from './unmatched-transactions.service';

@ApiTags('admin-unmatched-transactions')
@ApiBearerAuth()
@Roles('ADMIN')
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/unmatched-transactions')
export class AdminUnmatchedTransactionsController {
  constructor(
    private readonly unmatchedService: UnmatchedTransactionsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin xem tiền chưa khớp (tiền đã vào tài khoản nhưng không ghi nhận vào đơn: không mã, sai mã, về trễ, chuyển thiếu...), mới nhất lên đầu',
  })
  @ApiResponse({
    status: 400,
    description: 'status không phải OPEN/RESOLVED, page < 1, limit ngoài 1–50',
  })
  list(@Query() query: QueryUnmatchedTransactionDto) {
    return this.unmatchedService.list(query);
  }

  @Post(':id/refund')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Admin hoàn một khoản tiền chưa khớp: tạo lệnh chi UNMATCHED_REFUND chi ngay (chuyển xong bấm "Đã chuyển" ở lệnh chi)',
  })
  @ApiResponse({
    status: 400,
    description:
      'REFUND_BANK_INFO_REQUIRED (không có tài khoản gợi ý và không nhập) | RESOLUTION_NOTE_REQUIRED (không gắn đơn hoặc đổi tài khoản mà thiếu ghi chú) | BANK_INFO_INCOMPLETE | BANK_INFO_CANNOT_BE_CLEARED',
  })
  @ApiResponse({ status: 404, description: 'UNMATCHED_TRANSACTION_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'TRANSACTION_ALREADY_RESOLVED (đã hoàn) | TRANSACTION_NOT_REFUNDABLE (tiền đã vào đơn)',
  })
  refund(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RefundUnmatchedTransactionDto,
  ) {
    return this.unmatchedService.refund(user.accountId, id, dto);
  }
}
