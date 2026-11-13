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
import { DisputesService } from './disputes.service';
import { QueryDisputeDto } from './dto/query-dispute.dto';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

@ApiTags('admin-disputes')
@ApiBearerAuth()
@Roles('ADMIN') // cấp class: mọi route đều cần ADMIN
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin xem danh sách tranh chấp; cái quá hạn mềm 5 ngày nổi lên đầu, mỗi dòng có isOverdue',
  })
  @ApiResponse({
    status: 400,
    description: 'status không hợp lệ, page < 1, limit ngoài 1–50',
  })
  list(@Query() query: QueryDisputeDto) {
    return this.disputesService.listForAdmin(query);
  }

  @Get(':disputeId')
  @ApiOperation({
    summary:
      'Admin xem hồ sơ đầy đủ của một tranh chấp kèm chuỗi bằng chứng (biên bản nhận/trả, cờ rủi ro, ý kiến phản đối, báo cáo chăm, bằng chứng hai bên, các đề nghị)',
  })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  get(@Param('disputeId', ParseUUIDPipe) disputeId: string) {
    return this.disputesService.getForAdmin(disputeId);
  }

  @Post(':disputeId/resolve')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Admin phân xử: kết luận từng cây bị khiếu nại (không nhập tiền) → hệ thống tự tính hoàn công + đền, đơn COMPLETED, chia tiền',
  })
  @ApiResponse({
    status: 400,
    description:
      'DISPUTE_VERDICT_INCOMPLETE (thiếu, dư hoặc trùng cây so với các cây bị khiếu nại) | thiếu note, note > 4000 ký tự, verdict không hợp lệ',
  })
  @ApiResponse({ status: 404, description: 'DISPUTE_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DISPUTE_NOT_IN_REVIEW' })
  @ApiResponse({ status: 500, description: 'ESCROW_BALANCE_INSUFFICIENT' })
  resolve(
    @CurrentUser() user: CurrentUserData,
    @Param('disputeId', ParseUUIDPipe) disputeId: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.disputesService.resolve(user.accountId, disputeId, dto);
  }
}
