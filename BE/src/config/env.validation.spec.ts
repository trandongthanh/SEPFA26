import { envValidationSchema } from './env.validation';

// Bộ env tối thiểu hợp lệ (các biến bắt buộc sẵn có từ trước).
const BASE = {
  DB_HOST: 'localhost',
  DB_PORT: 5432,
  DB_USERNAME: 'u',
  DB_PASSWORD: 'p',
  DB_NAME: 'db',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  DATA_ENCRYPTION_KEY: '0'.repeat(64),
  SEED_ADMIN_EMAIL: 'admin@lancarehub.vn',
  SEED_ADMIN_PASSWORD: 'password123',
  STREAM_API_KEY: 'k',
  STREAM_API_SECRET: 's',
  SEPAY_WEBHOOK_KEY: 'x'.repeat(16),
};

const SMTP = {
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_USER: 'lancare@gmail.com',
  SMTP_PASS: 'app-password',
  APP_BASE_URL: 'http://localhost:3002',
};

const errorKeys = (env: Record<string, unknown>) =>
  (
    envValidationSchema.validate(env, { abortEarly: false }).error?.details ??
    []
  ).map((detail) => detail.context?.key);

describe('envValidationSchema — SMTP', () => {
  it('không cấu hình SMTP → hợp lệ (dev: bỏ qua gửi mail)', () => {
    expect(errorKeys(BASE)).toEqual([]);
  });

  it('SMTP_HOST rỗng → coi như tắt, không đòi USER/PASS/APP_BASE_URL', () => {
    expect(errorKeys({ ...BASE, SMTP_HOST: '', SMTP_USER: '' })).toEqual([]);
  });

  it('đủ cấu hình SMTP → hợp lệ', () => {
    expect(errorKeys({ ...BASE, ...SMTP })).toEqual([]);
  });

  it.each(['SMTP_USER', 'SMTP_PASS', 'APP_BASE_URL'])(
    'có SMTP_HOST mà thiếu %s → app không khởi động',
    (missing) => {
      const env: Record<string, unknown> = { ...BASE, ...SMTP };
      delete env[missing];
      expect(errorKeys(env)).toEqual([missing]);
    },
  );

  it('có SMTP_HOST mà APP_BASE_URL không phải URL → lỗi', () => {
    expect(errorKeys({ ...BASE, ...SMTP, APP_BASE_URL: 'localhost' })).toEqual([
      'APP_BASE_URL',
    ]);
  });
});

describe('envValidationSchema — THROTTLE_DISABLED', () => {
  it('dev/test được tắt rate limit', () => {
    expect(
      errorKeys({ ...BASE, NODE_ENV: 'test', THROTTLE_DISABLED: 'true' }),
    ).toEqual([]);
  });

  it('production KHÔNG được tắt rate limit → app không khởi động', () => {
    expect(
      errorKeys({ ...BASE, NODE_ENV: 'production', THROTTLE_DISABLED: 'true' }),
    ).toEqual(['THROTTLE_DISABLED']);
  });

  it('production để false hoặc bỏ trống → hợp lệ', () => {
    expect(
      errorKeys({
        ...BASE,
        NODE_ENV: 'production',
        THROTTLE_DISABLED: 'false',
      }),
    ).toEqual([]);
    expect(errorKeys({ ...BASE, NODE_ENV: 'production' })).toEqual([]);
  });
});

describe('envValidationSchema — video call', () => {
  const validated = (env: Record<string, unknown>) =>
    envValidationSchema.validate(env, { abortEarly: false }).value as Record<
      string,
      unknown
    >;

  it('không khai gì → mặc định (lancare_call, 45s đổ chuông, chờ 300s, tối đa 3600s)', () => {
    expect(errorKeys(BASE)).toEqual([]);
    expect(validated(BASE)).toMatchObject({
      STREAM_CALL_TYPE: 'lancare_call',
      STREAM_SYSTEM_USER_ID: 'lancare-system',
      VIDEO_CALL_RING_TIMEOUT_SECONDS: 45,
      VIDEO_CALL_RECONNECT_GRACE_SECONDS: 300,
      VIDEO_CALL_MAX_DURATION_SECONDS: 3600,
    });
  });

  it('giá trị chuỗi trong .env → ép về số; giá trị biên hợp lệ', () => {
    const env = {
      ...BASE,
      VIDEO_CALL_RING_TIMEOUT_SECONDS: '10',
      VIDEO_CALL_RECONNECT_GRACE_SECONDS: '600',
      VIDEO_CALL_MAX_DURATION_SECONDS: '14400',
    };
    expect(errorKeys(env)).toEqual([]);
    expect(validated(env)).toMatchObject({
      VIDEO_CALL_RING_TIMEOUT_SECONDS: 10,
      VIDEO_CALL_RECONNECT_GRACE_SECONDS: 600,
      VIDEO_CALL_MAX_DURATION_SECONDS: 14400,
    });
  });

  it.each<[string, unknown]>([
    ['VIDEO_CALL_RING_TIMEOUT_SECONDS', 9],
    ['VIDEO_CALL_RING_TIMEOUT_SECONDS', 301],
    ['VIDEO_CALL_RING_TIMEOUT_SECONDS', 45.5],
    ['VIDEO_CALL_RECONNECT_GRACE_SECONDS', 9],
    ['VIDEO_CALL_RECONNECT_GRACE_SECONDS', 601],
    ['VIDEO_CALL_MAX_DURATION_SECONDS', 59],
    ['VIDEO_CALL_MAX_DURATION_SECONDS', 14401],
    ['STREAM_CALL_TYPE', 'Lancare_Call'],
    ['STREAM_CALL_TYPE', 'lancare-call'],
    ['STREAM_CALL_TYPE', 'default:x'],
  ])('%s = %p không hợp lệ → app không khởi động', (key, value) => {
    expect(errorKeys({ ...BASE, [key]: value })).toEqual([key]);
  });
});
