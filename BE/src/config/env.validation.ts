import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),

  // Cloud tiêm DATABASE_URL (1 chuỗi) — có nó thì bộ DB_* rời không bắt buộc.
  DATABASE_URL: Joi.string().uri().optional(),
  DB_HOST: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_PORT: Joi.number().port().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_USERNAME: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_PASSWORD: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),
  DB_NAME: Joi.string().when('DATABASE_URL', {
    is: Joi.exist(),
    then: Joi.optional(),
    otherwise: Joi.required(),
  }),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRES: Joi.string().default('15m'),
  JWT_REFRESH_SECRET: Joi.string()
    .min(32)
    .required()
    .disallow(Joi.ref('JWT_ACCESS_SECRET')),
  JWT_REFRESH_EXPIRES: Joi.string().default('7d'),

  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(10).max(15).default(12),

  DATA_ENCRYPTION_KEY: Joi.string().hex().length(64).required(),

  SEED_ADMIN_EMAIL: Joi.string().email().required(),
  SEED_ADMIN_PASSWORD: Joi.string().min(8).required(),
  STREAM_API_KEY: Joi.string().required(),
  STREAM_API_SECRET: Joi.string().required(),
  CLOUDINARY_URL: Joi.string().pattern(/^cloudinary:\/\//).optional(),
  APP_BASE_URL: Joi.string().uri().optional(),

  // Đã dùng ở main.ts/typeorm.config.ts từ trước nhưng chưa khai schema — bổ sung cho tường minh.
  CORS_ORIGIN: Joi.string().optional(),
  DB_SSL: Joi.string().valid('true', 'false').optional(),

  // Bảo vệ trang /api/docs. Để trống ở local → vào thẳng; set trên prod → đòi Basic Auth.
  SWAGGER_USER: Joi.string().optional(),
  SWAGGER_PASSWORD: Joi.string().optional(),

  // Webhook SePay xác thực bằng API key (so sánh constant-time) — KHÔNG JWT.
  SEPAY_WEBHOOK_KEY: Joi.string().min(16).required(),

  // Có key → đo qua Google Distance Matrix; để trống → fallback đường chim bay × 1.3.
  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),
  ROUTING_PROVIDER: Joi.string().valid('osrm', 'google').default('osrm'),
  OSRM_BASE_URL: Joi.string().uri().allow('').optional(),
  PLANTNET_API_KEY: Joi.string().allow('').optional(),
  PLANTNET_PROJECT: Joi.string().default('all'),
  PLANT_ID_API_KEY: Joi.string().allow('').optional(),

  // Tài khoản nhận tiền in lên mã VietQR (default chỉ để dev/demo).
  BANK_BIN: Joi.string().default('970422'),
  BANK_ACCOUNT_NUMBER: Joi.string().default('0000000000'),
  BANK_ACCOUNT_NAME: Joi.string().default('LANCARE HUB'),
});
