import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ProvidersService } from './providers.service';
import { VerifyProviderDto } from './dto/verify-provider.dto';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

class VerifyPackageDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsIn(['APPROVED', 'REJECTED'])
  decision?: 'APPROVED' | 'REJECTED';

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;
}

@ApiTags('admin-providers')
@ApiBearerAuth()
@Roles('ADMIN') // cấp class: mọi route đều cần ADMIN
@Controller('admin/providers')
export class AdminProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Get()
  @ApiOperation({
    summary:
      'Admin lấy danh sách tất cả provider (PENDING, APPROVED, REJECTED)',
  })
  listAll() {
    return this.providersService.listAllForAdmin();
  }

  @Post(':providerId/verify')
  @ApiOperation({ summary: 'Admin duyệt/từ chối hồ sơ provider' })
  verify(
    @Param('providerId') providerId: string,
    @Body() dto: VerifyProviderDto,
  ) {
    return this.providersService.verifyProvider(providerId, dto);
  }

  @Get('packages')
  @ApiOperation({ summary: 'Admin xem tất cả service package để duyệt' })
  listPackages() {
    return this.providersService.listAllPackagesForAdmin();
  }

  @Get(':providerId')
  @ApiOperation({
    summary: 'Admin xem đầy đủ hồ sơ Provider và toàn bộ gói dịch vụ',
  })
  getProviderDetail(@Param('providerId') providerId: string) {
    return this.providersService.getAdminProviderDetail(providerId);
  }

  @Post('packages/:packageId/verify')
  @ApiOperation({ summary: 'Admin bật/tắt một service package' })
  verifyPackage(
    @Param('packageId') packageId: string,
    @Body() dto: VerifyPackageDto,
  ) {
    return this.providersService.setPackageActive(
      packageId,
      dto.isActive,
      dto.decision,
      dto.note,
    );
  }

  @Post(':providerId/reset-password')
  @ApiOperation({
    summary: 'Admin reset mật khẩu provider, trả về mật khẩu tạm thời',
  })
  @ApiResponse({ status: 201, description: 'Trả về { tempPassword }' })
  resetPassword(@Param('providerId') providerId: string) {
    return this.providersService.resetProviderPassword(providerId);
  }

  @Delete(':providerId')
  @ApiOperation({ summary: 'Admin xóa hoàn toàn hồ sơ và tài khoản provider' })
  remove(@Param('providerId') providerId: string) {
    return this.providersService.deleteProviderForAdmin(providerId);
  }
}
