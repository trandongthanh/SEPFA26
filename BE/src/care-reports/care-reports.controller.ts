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
import type { CurrentUserData } from '../auth/types/current-user.type';
import { Roles } from '../auth/decorators/roles.decorator';
import { CreateCareReportDto } from './dto/create-care-report.dto';
import { QueryCareReportDto } from './dto/query-care-report.dto';
import { CareReportsService } from './care-reports.service';

@ApiTags('care-reports')
@ApiBearerAuth()
@Controller('care-reports')
export class CareReportsController {
  constructor(private readonly careReportsService: CareReportsService) {}

  @Roles('PROVIDER')
  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Nhà vườn nộp báo cáo chăm sóc kỳ kế tiếp (server tự tính kỳ)',
  })
  @ApiResponse({
    status: 201,
    description:
      '{ id, serviceOrderId, periodIndex, periodStart, periodEnd, isLate, submittedAt }',
  })
  @ApiResponse({
    status: 400,
    description:
      'ORDER_NOT_IN_CARE | REPORT_PLANTS_MISMATCH | PLANT_PHOTO_REQUIRED | CARE_ACTIVITY_INVALID',
  })
  @ApiResponse({ status: 403, description: 'PROVIDER_NOT_ALLOWED' })
  @ApiResponse({ status: 404, description: 'SERVICE_ORDER_NOT_FOUND' })
  @ApiResponse({
    status: 409,
    description:
      'REPORT_PERIOD_NOT_STARTED | ALL_PERIODS_SUBMITTED | CARE_REPORT_DUPLICATE',
  })
  createCareReport(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCareReportDto,
  ) {
    return this.careReportsService.createCareReport(
      user.accountId,
      user.role,
      dto,
    );
  }

  @Roles('PROVIDER', 'ADMIN', 'CUSTOMER')
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết báo cáo chăm sóc (kèm từng cây + ảnh)' })
  @ApiResponse({ status: 404, description: 'CARE_REPORT_NOT_FOUND' })
  getCareReport(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.careReportsService.getCareReport(user.accountId, user.role, id);
  }

  @Roles('PROVIDER', 'ADMIN', 'CUSTOMER')
  @Get()
  @ApiOperation({ summary: 'Danh sách báo cáo chăm sóc theo đơn, xếp theo kỳ' })
  @ApiResponse({
    status: 403,
    description: 'PROVIDER_NOT_ALLOWED | CUSTOMER_NOT_ALLOWED',
  })
  listCareReports(
    @CurrentUser() user: CurrentUserData,
    @Query() query: QueryCareReportDto,
  ) {
    return this.careReportsService.listCareReports(
      user.accountId,
      user.role,
      query,
    );
  }
}
