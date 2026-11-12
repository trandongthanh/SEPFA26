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
import { DisbursementsService } from './disbursements.service';
import { MarkDisbursementPaidDto } from './dto/mark-disbursement-paid.dto';
import { QueryDisbursementDto } from './dto/query-disbursement.dto';

@ApiTags('admin-disbursements')
@ApiBearerAuth()
@Roles('ADMIN') // cấp class: mọi route đều cần ADMIN
@ApiResponse({ status: 403, description: 'INSUFFICIENT_ROLE' })
@Controller('admin/disbursements')
export class AdminDisbursementsController {
  constructor(private readonly disbursementsService: DisbursementsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin xem danh sách lệnh chi (tiền phải chuyển cho vườn), lệnh tới hạn sớm nhất lên đầu',
  })
  @ApiResponse({
    status: 400,
    description: 'status không hợp lệ, page < 1, limit ngoài 1–50',
  })
  list(@Query() query: QueryDisbursementDto) {
    return this.disbursementsService.list(query);
  }

  @Post(':id/mark-paid')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Admin xác nhận đã chuyển khoản cho vườn (bấm "Đã chuyển")',
  })
  @ApiResponse({
    status: 400,
    description:
      'id không phải UUID, thiếu/trống transferCode, transferCode > 100 ký tự, note > 1000 ký tự',
  })
  @ApiResponse({ status: 404, description: 'DISBURSEMENT_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'DISBURSEMENT_ALREADY_PAID' })
  @ApiResponse({
    status: 409,
    description: 'DISBURSEMENT_NOT_ELIGIBLE (chưa hết 3 ngày chờ khiếu nại)',
  })
  @ApiResponse({
    status: 409,
    description:
      'PROVIDER_BANK_INFO_MISSING (vườn chưa khai đủ tên ngân hàng, số tài khoản, chủ tài khoản)',
  })
  @ApiResponse({
    status: 409,
    description:
      'DISBURSEMENT_BANK_INFO_MISSING (lệnh hoàn tiền khách chưa có tài khoản nhận — chưa dùng ở đợt này)',
  })
  markPaid(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkDisbursementPaidDto,
  ) {
    return this.disbursementsService.markPaid(user.accountId, id, dto);
  }
}
