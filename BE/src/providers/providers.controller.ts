import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import type { CurrentUserData } from '../auth/types/current-user.type';
import { ProvidersService } from './providers.service';
import { QueryProviderDto } from './dto/query-provider.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { UpsertPackageDto } from './dto/upsert-package.dto';

@ApiTags('providers')
@Controller('providers')
export class ProvidersController {
  constructor(private readonly providersService: ProvidersService) {}

  @Public() // khách vãng lai xem được, không cần đăng nhập
  @Get()
  @ApiOperation({
    summary: 'Khách duyệt danh sách provider đã duyệt (lọc + phân trang)',
  })
  browse(@Query() query: QueryProviderDto) {
    return this.providersService.browse(query);
  }

  @Roles('PROVIDER')
  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider lấy thông tin hồ sơ của mình' })
  getMyProfile(@CurrentUser() user: CurrentUserData) {
    return this.providersService.getMyProfile(user.accountId);
  }

  @Roles('PROVIDER')
  @Put('me/profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider tạo/cập nhật hồ sơ của mình (upsert)' })
  upsertProfile(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpsertProfileDto,
  ) {
    return this.providersService.upsertProfile(user.accountId, dto);
  }

  @Roles('PROVIDER')
  @Post('me/packages')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Provider tạo gói dịch vụ mới (cần hồ sơ đã APPROVED)',
  })
  createPackage(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: UpsertPackageDto,
  ) {
    return this.providersService.createPackage(user?.accountId || '', dto);
  }

  @Roles('PROVIDER')
  @Get('me/packages')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider xem danh sách gói dịch vụ của mình' })
  listMyPackages(@CurrentUser() user: CurrentUserData) {
    return this.providersService.listMyPackages(user.accountId);
  }

  @Roles('PROVIDER')
  @Get('me/packages/:packageId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider lấy chi tiết 1 gói dịch vụ của mình' })
  getMyPackage(
    @CurrentUser() user: CurrentUserData,
    @Param('packageId') packageId: string,
  ) {
    return this.providersService.getMyPackage(user?.accountId || '', packageId);
  }

  @Roles('PROVIDER')
  @Put('me/packages/:packageId')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider sửa gói dịch vụ của mình' })
  updatePackage(
    @CurrentUser() user: CurrentUserData,
    @Param('packageId') packageId: string,
    @Body() dto: UpsertPackageDto,
  ) {
    return this.providersService.updatePackage(
      user?.accountId || '',
      packageId,
      dto,
    );
  }

  @Roles('PROVIDER')
  @Delete('me/packages/:packageId')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Provider xóa (mềm) gói dịch vụ của mình' })
  deletePackage(
    @CurrentUser() user: CurrentUserData,
    @Param('packageId') packageId: string,
  ) {
    return this.providersService.deletePackage(
      user?.accountId || '',
      packageId,
    );
  }

  @Public()
  @Get(':providerId')
  @ApiOperation({ summary: 'Khách xem chi tiết 1 provider theo ID' })
  getById(@Param('providerId', ParseUUIDPipe) providerId: string) {
    return this.providersService.getById(providerId);
  }

  @Public()
  @Get(':providerId/packages')
  @ApiOperation({ summary: 'Khách xem danh sách gói đang bán của 1 provider' })
  listPublicPackages(@Param('providerId') providerId: string) {
    return this.providersService.listPublicPackages(providerId);
  }
}
