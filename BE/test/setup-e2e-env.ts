// Env cho e2e — chạy TRƯỚC khi import AppModule (khai trong jest-e2e.json → setupFiles).
// Giá trị process.env thắng file .env nên e2e không bị ảnh hưởng bởi .env của máy dev.
//
// Chạy: cd BE && npx jest --config ./test/jest-e2e.json test/auth.e2e-spec.ts
// Cần: Postgres của docker-compose đang chạy + database test đã tạo 1 lần:
//   docker exec lancare-hub-postgres psql -U lancare -d postgres -c "CREATE DATABASE lancare_hub_test"
// Database test bị XOÁ SẠCH mỗi lần chạy (auth-test-app.ts chặn nếu tên DB không kết thúc _test).
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DB_HOST: 'localhost',
  DB_PORT: '5432',
  DB_USERNAME: 'lancare',
  DB_PASSWORD: 'lancare_dev_pw',
  DB_NAME: 'lancare_hub_test',
  JWT_ACCESS_SECRET: 'e2e-access-secret-0123456789abcdef0123456789',
  JWT_REFRESH_SECRET: 'e2e-refresh-secret-0123456789abcdef012345678',
  BCRYPT_SALT_ROUNDS: '10',
  DATA_ENCRYPTION_KEY: '0'.repeat(64),
  SEED_ADMIN_EMAIL: 'e2e-admin@lancarehub.vn',
  SEED_ADMIN_PASSWORD: 'admin-e2e-password',
  STREAM_API_KEY: 'e2e-stream-key',
  STREAM_API_SECRET: 'e2e-stream-secret',
  SEPAY_WEBHOOK_KEY: 'e2e-sepay-webhook-key',
  GOOGLE_CLIENT_IDS: 'e2e-google-client-id',
  APP_BASE_URL: 'http://localhost:3002',
};

// E2E_DB_* cho phép trỏ sang DB test khác mà không đụng DB_* của dev.
for (const [key, value] of Object.entries(defaults)) {
  const override = process.env[`E2E_${key}`];
  process.env[key] = override ?? value;
}
// Không kế thừa DATABASE_URL (Neon/prod) từ shell — e2e luôn dùng DB_* ở trên.
delete process.env.DATABASE_URL;
