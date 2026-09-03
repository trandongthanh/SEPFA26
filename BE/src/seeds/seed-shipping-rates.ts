import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { ShippingRate } from '../orders/entities/shipping-rate.entity';

// Seed 3 bậc giá đi lấy cây (nối liền mạch tại ranh giới — xem shipping-fee.spec.ts).
// Idempotent: bảng đã có dữ liệu thì bỏ qua. Chạy: npm run seed:shipping-rates
async function seedShippingRates() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('SeedShippingRates');

  try {
    const rates = app.get(DataSource).getRepository(ShippingRate);
    const existing = await rates.find({ order: { minKm: 'ASC' } });
    const isLegacyDefault =
      existing.length === 3 &&
      existing[0].minKm === '0.00' &&
      existing[0].maxKm === '5.00' &&
      existing[0].baseFee === '20000' &&
      existing[1].minKm === '5.00' &&
      existing[1].maxKm === '15.00' &&
      existing[1].baseFee === '20000' &&
      existing[2].minKm === '15.00' &&
      existing[2].maxKm === null &&
      existing[2].baseFee === '50000';
    if (existing.length > 0 && !isLegacyDefault) {
      logger.log('shipping_rates already contains a custom configuration, skipping seed.');
      return;
    }
    if (isLegacyDefault) await rates.remove(existing);

    if (false) {
      logger.log('shipping_rates đã có dữ liệu, bỏ qua.');
      return;
    }

    await rates.save(
      rates.create([
        { minKm: '0.00', maxKm: '1.00', baseFee: '100000', perKmFee: '0', billingUnitKm: null },
        { minKm: '1.00', maxKm: '5.00', baseFee: '300000', perKmFee: '0', billingUnitKm: null },
        { minKm: '5.00', maxKm: '10.00', baseFee: '1000000', perKmFee: '0', billingUnitKm: null },
        { minKm: '10.00', maxKm: null, baseFee: '1000000', perKmFee: '500000', billingUnitKm: '5.00' },
      ]),
    );
    logger.log('Đã seed 3 bậc giá ship (0-5km / 5-15km / >15km).');
  } finally {
    await app.close();
  }
}

void seedShippingRates();
