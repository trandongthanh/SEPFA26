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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
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
  @ApiOperation({ summary: 'Nhà vườn nộp báo cáo chăm sóc theo tần suất gói dịch vụ' })
  createCareReport(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateCareReportDto,
  ) {
    return this.careReportsService.createCareReport(user.accountId, user.role, dto);
  }

  @Roles('PROVIDER', 'ADMIN', 'CUSTOMER')
  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết báo cáo chăm sóc' })
  getCareReport(
    @CurrentUser() user: CurrentUserData,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.careReportsService.getCareReport(user.accountId, user.role, id);
  }

  @Roles('PROVIDER', 'ADMIN', 'CUSTOMER')
  @Get()
  @ApiOperation({ summary: 'Danh sách báo cáo chăm sóc theo đơn' })
  listCareReports(
    @CurrentUser() user: CurrentUserData,
    @Query() query: QueryCareReportDto,
  ) {
    return this.careReportsService.listCareReports(user.accountId, user.role, query);
  }
}
