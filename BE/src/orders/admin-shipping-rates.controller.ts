import { Body, Controller, Get, Put } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Roles } from '../auth/decorators/roles.decorator';
import { ReplaceShippingRatesDto } from './dto/replace-shipping-rates.dto';
import { OrdersService } from './orders.service';

@ApiTags('admin-shipping-rates')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin/shipping-rates')
export class AdminShippingRatesController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get()
  @ApiOperation({ summary: 'Admin xem bảng phí lấy cây theo quãng đường' })
  list() {
    return this.ordersService.listShippingRatesForAdmin();
  }

  @Put()
  @ApiOperation({ summary: 'Admin thay thế bảng phí lấy cây' })
  replace(@Body() dto: ReplaceShippingRatesDto) {
    return this.ordersService.replaceShippingRates(dto.rates);
  }
}
