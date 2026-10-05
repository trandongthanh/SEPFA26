import {
  ClassSerializerInterceptor,
  INestApplication,
  ValidationPipe,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import helmet from 'helmet';

// Cấu hình HTTP dùng chung cho main.ts và e2e (test/auth-test-app.ts) — e2e phải chạy
// đúng pipeline như production. Thêm pipe/interceptor/middleware toàn cục thì thêm Ở ĐÂY.
// CORS, trust proxy, Swagger chỉ có ý nghĩa khi chạy server thật → vẫn nằm ở main.ts.
export function configureApp(app: INestApplication): void {
  // Header bảo mật mặc định (nosniff, HSTS, frameguard, ẩn X-Powered-By...).
  // Tắt CSP: API chỉ trả JSON, còn Swagger UI trên Vercel nạp script/CSS từ CDN jsdelivr.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Lưới an toàn: entity trả ra (kể cả lồng trong object thường) được serialize qua
  // class-transformer → field @Exclude (passwordHash, phoneHash) bị loại. KHÔNG cứu được
  // `{ ...entity }` (spread mất prototype) — response chứa Account phải qua toAccountSummary().
  // enableCircularCheck: quan hệ TypeORM 2 chiều không làm serialize đệ quy vô hạn.
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector), {
      enableCircularCheck: true,
    }),
  );

  app.setGlobalPrefix('api/v1');
}
