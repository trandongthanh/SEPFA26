// P1: origin mặc định khi không khai CORS_ORIGIN — giống main.ts (web FE chạy local).
const DEFAULT_CORS_ORIGIN = 'http://localhost:3002';

// Danh sách origin được phép từ CORS_ORIGIN (cách nhau dấu phẩy), cùng luật với HTTP ở main.ts.
export function parseAllowedOrigins(env: string | undefined): string[] {
  return (env ?? DEFAULT_CORS_ORIGIN)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * P1: không có header Origin (app mobile, client Node) → cho qua (vẫn phải có token);
 * có Origin (trình duyệt luôn gửi) thì phải nằm trong danh sách.
 */
export function isOriginAllowed(
  origin: string | undefined,
  allowed: readonly string[],
): boolean {
  if (!origin) {
    return true;
  }
  return allowed.includes(origin);
}
