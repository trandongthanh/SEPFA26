import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { CustomersService } from './customers.service';
import { UpsertCustomerProfileDto } from './dto/upsert-customer-profile.dto';
import { VerifyCustomerDto } from './dto/verify-customer.dto';

@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) { }

  @Roles('CUSTOMER')
  @Get('me/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Khách xem hồ sơ của mình (địa chỉ + GPS đã ghim)' })
  getMyProfile(@CurrentUser() user: CurrentUserData) {
    return this.customersService.getMyProfile(user.accountId);
  }

  @Roles('CUSTOMER')
  @Put('me/profile')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Khách cập nhật hồ sơ + ghim GPS (tiền đề tính phí đi lấy cây)',
  })
  @ApiResponse({
    status: 400,
    description:
      'BANK_INFO_INCOMPLETE (gửi thiếu 1 trong 3 trường ngân hàng hoặc bankBin một mình) | BANK_INFO_CANNOT_BE_CLEARED (gửi rỗng/null để xoá)',
  })
  updateMyProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpsertCustomerProfileDto,
  ) {
    return this.customersService.updateMyProfile(user.accountId, dto);
  }

  @Roles('ADMIN')
  @Get('admin')
  listForAdmin() { return this.customersService.listForAdmin(); }

  @Roles('ADMIN')
  @Get('admin/:customerId')
  getForAdmin(@Param('customerId') customerId: string) { return this.customersService.getForAdmin(customerId); }

  @Roles('ADMIN')
  @Post('admin/:customerId/verify')
  verifyForAdmin(@Param('customerId') customerId: string, @Body() dto: VerifyCustomerDto) {
    return this.customersService.verifyForAdmin(customerId, dto);
  }
}
