import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AppModule } from '../app.module';
import { Account } from '../accounts/entities/account.entity';
import { PasswordService } from '../crypto/password.service';

// Tạo tài khoản ADMIN đầu tiên từ biến môi trường. Idempotent: chạy lại không tạo trùng.
// Chạy: npm run seed:admin
async function seedAdmin() {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn'],
  });
  const logger = new Logger('SeedAdmin');

  try {
    const config = app.get(ConfigService);
    const dataSource = app.get(DataSource);
    const passwords = app.get(PasswordService);
    const accounts = dataSource.getRepository(Account);

    const email = config.get<string>('SEED_ADMIN_EMAIL')!;
    const password = config.get<string>('SEED_ADMIN_PASSWORD')!;

    const existing = await accounts.findOne({ where: { email } });
    if (existing) {
      logger.log(`Admin đã tồn tại (${email}), bỏ qua.`);
      return;
    }

    await accounts.save(
      accounts.create({
        email,
        passwordHash: await passwords.hash(password),
        fullName: 'Platform Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    logger.log(`Đã tạo admin: ${email}`);
  } finally {
    await app.close();
  }
}

void seedAdmin();
