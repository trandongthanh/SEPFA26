import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

export const buildTypeOrmOptions = (
  config: ConfigService,
): TypeOrmModuleOptions => {
  const nodeEnv = config.get<string>('NODE_ENV', 'development');
  const isProd = nodeEnv === 'production';
  const sslEnabled = config.get<string>('DB_SSL', 'false') === 'true';

  const shared = {
    autoLoadEntities: true,
    // synchronize is strictly local-development convenience. Production schema
    // changes must be deployed through a reviewed migration process.
    synchronize: !isProd,
    logging: (!isProd ? ['query', 'error', 'warn'] : ['error']) as (
      'query' | 'error' | 'warn'
    )[],
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
