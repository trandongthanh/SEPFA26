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
import { DisputesService } from './disputes.service';
import { AddDisputeEvidenceDto } from './dto/add-dispute-evidence.dto';
import { CreateDisputeOfferDto } from './dto/create-dispute-offer.dto';
import { OpenDisputeDto } from './dto/open-dispute.dto';

// Các route của hai bên chỉ nhận CUSTOMER / PROVIDER (@Roles đã chặn) → thu hẹp kiểu cho service.
type PartyRole = 'CUSTOMER' | 'PROVIDER';

/**
 * Tranh chấp của đơn — đường dẫn số ít `/orders/:orderId/dispute` vì mỗi đơn tối đa một tranh chấp.
 * Admin dùng `/admin/disputes` (admin-disputes.controller.ts).
 */
@ApiTags('disputes')
@ApiBearerAuth()
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@ApiResponse({ status: 404, description: 'ORDER_NOT_FOUND' })
@Controller('orders/:orderId/dispute')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Roles('CUSTOMER')
  @Post()
  @ApiOperation({
    summary:
      'Khách mở tranh chấp trong 48 giờ sau khi vườn chốt trả cây (đơn RETURN_AWAITING_CONFIRM → DISPUTED), hai bên có 3 ngày thương lượng',
  })
  @ApiResponse({
    status: 400,
    description:
      'PLANT_NOT_IN_CARE (cây không thuộc đơn hoặc bị từ chối lúc nhận) | body sai (thiếu cây, cây trùng, thiếu ảnh, quá 10 ảnh)',
  })
  @ApiResponse({
    status: 409,
    description:
      'REFUND_BANK_ACCOUNT_REQUIRED (khách chưa khai đủ tài khoản ngân hàng) | DISPUTE_WINDOW_CLOSED (đã quá 48 giờ) | INVALID_STATE_TRANSITION (đơn không ở chặng chờ khách xác nhận nhận lại cây, hoặc đã có tranh chấp)',
  })
  open(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: OpenDisputeDto,
  ) {
    return this.disputesService.openDispute(user.accountId, orderId, dto);
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Get()
  @ApiOperation({
    summary:
      'Khách hoặc vườn của đơn xem hồ sơ tranh chấp: trạng thái, các hạn, cây bị khiếu nại, bằng chứng hai bên, các đề nghị, hai trần, kết quả',
  })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  get(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.disputesService.getDispute(
      user.accountId,
      user.role as PartyRole,
      orderId,
    );
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Post('evidence')
  @ApiOperation({
    summary:
      'Khách hoặc vườn nộp thêm bằng chứng (1–10 ảnh mỗi lần) khi tranh chấp chưa kết thúc',
  })
  @ApiResponse({ status: 400, description: 'PLANT_NOT_IN_CARE' })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DISPUTE_CLOSED' })
  addEvidence(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: AddDisputeEvidenceDto,
  ) {
    return this.disputesService.addEvidence(
      user.accountId,
      user.role as PartyRole,
      orderId,
      dto,
    );
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Post('offers')
  @ApiOperation({
    summary:
      'Khách hoặc vườn gửi đề nghị thương lượng (hoàn tiền công + tiền đền); đề nghị đang chờ trước đó bị thay',
  })
  @ApiResponse({
    status: 400,
    description:
      'OFFER_EXCEEDS_CAP (vượt trần hoàn công hoặc trần đền) | OFFER_EMPTY (hai số cùng bằng 0)',
  })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'DISPUTE_NOT_NEGOTIATING (đã sang admin, đã xong, hoặc quá hạn 3 ngày)',
  })
  createOffer(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Body() dto: CreateDisputeOfferDto,
  ) {
    return this.disputesService.createOffer(
      user.accountId,
      user.role as PartyRole,
      orderId,
      dto,
    );
  }

  @Roles('CUSTOMER', 'PROVIDER')
  @Post('offers/:offerId/accept')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Bên còn lại đồng ý một đề nghị → tranh chấp xong, đơn COMPLETED, chia tiền; settlement trả về là phần của người gọi',
  })
  @ApiResponse({ status: 403, description: 'OFFER_OWN' })
  @ApiResponse({
    status: 404,
    description: 'DISPUTE_NOT_FOUND | OFFER_NOT_FOUND',
  })
  @ApiResponse({
    status: 409,
    description:
      'OFFER_NOT_PENDING (đề nghị đã bị thay, tranh chấp đã sang admin / đã xong, hoặc quá hạn 3 ngày)',
  })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  acceptOffer(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
    @Param('offerId', ParseUUIDPipe) offerId: string,
  ) {
    return this.disputesService.acceptOffer(
      user.accountId,
      user.role as PartyRole,
      orderId,
      offerId,
    );
  }

  @Roles('CUSTOMER')
  @Post('withdraw')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Khách rút khiếu nại khi còn thương lượng → đơn COMPLETED, chia tiền như đơn bình thường, không tính là khách thua',
  })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DISPUTE_NOT_NEGOTIATING' })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  withdraw(
    @CurrentUser() user: CurrentUserData,
    @Param('orderId', ParseUUIDPipe) orderId: string,
  ) {
    return this.disputesService.withdraw(user.accountId, orderId);
  }
}
