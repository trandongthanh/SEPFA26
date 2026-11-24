import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { LoggerOptions } from 'typeorm';

export const buildTypeOrmOptions = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const sslEnabled = config.get<string>('DB_SSL', 'false') === 'true';
  const logging: LoggerOptions =
    nodeEnv === 'test'
      ? false
      : nodeEnv === 'development'
        ? ['query', 'error', 'warn']
        : ['error'];

  const shared = {
    autoLoadEntities: true,
    // synchronize is strictly local-development convenience. Production schema
    // changes must be deployed through a reviewed migration process.
    // ⚠ synchronize BẬT với MỌI NODE_ENV khác 'production' (kể cả 'test'): nó tự ALTER/DROP
    // cột cho khớp entity trên máy đang chạy. KHÔNG chạy dev trỏ vào DB dùng chung / đã deploy
    // (DATABASE_URL của nhóm) — xem DB đó bằng TablePlus thay vì chạy BE local vào.
    synchronize: !isProd,
    // Log từng câu SQL chỉ khi dev; prod chỉ log lỗi; e2e tắt hẳn (test cố ý gây lỗi unique).
    logging,
    // ssl:true = bật TLS + kiểm chứng chỉ (Neon dùng CA công khai nên verify chạy được).
    ssl: sslEnabled ? true : false,
  };

  // Cloud (Vercel + Neon) tiêm 1 chuỗi DATABASE_URL duy nhất; local dev vẫn dùng bộ DB_* rời.
  const databaseUrl = config.get<string>('DATABASE_URL');
  if (databaseUrl) {
    return { type: 'postgres', url: databaseUrl, ...shared };
  }

  return {
    type: 'postgres',
    host: config.get<string>('DB_HOST'),
    port: config.get<number>('DB_PORT'),
    username: config.get<string>('DB_USERNAME'),
    password: config.get<string>('DB_PASSWORD'),
    database: config.get<string>('DB_NAME'),
    ...shared,
  };
};
