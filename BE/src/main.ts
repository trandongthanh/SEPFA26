import { timingSafeEqual } from 'crypto';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  // Chỉ tin header X-Forwarded-For khi THẬT SỰ có proxy đứng trước (Vercel tự ghi đè header
  // này) — không bật thì @Ip()/rate limit thấy IP của proxy thay vì client.
  // Chạy thẳng `node dist/main` (local, demo trên laptop) mà vẫn bật thì client tự gửi
  // X-Forwarded-For để đổi req.ip → lách rate limit, giả IP ghi trong chữ ký hợp đồng.
  // Proxy khác (nginx, Render...): đặt TRUST_PROXY=true.
  if (process.env.VERCEL || config.get<string>('TRUST_PROXY') === 'true') {
    const expressApp = app.getHttpAdapter().getInstance() as {
      set: (key: string, value: unknown) => void;
    };
    expressApp.set('trust proxy', 1);
  }

  // ===== CORS Configuration =====
  const corsOrigin = config.get<string>('CORS_ORIGIN', 'http://localhost:3002');
  const allowedOrigins = corsOrigin.split(',').map((origin) => origin.trim());

  app.enableCors({
    origin: allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    // Cho FE web (khác origin) đọc header rate limit — vd hiện "thử lại sau N giây" từ
    // Retry-After khi nhận 429. Hậu tố -account = lớp đếm theo IP+email (common/throttle.ts).
    exposedHeaders: ['default', 'account'].flatMap((name) => {
      const suffix = name === 'default' ? '' : `-${name}`;
      return [
        `Retry-After${suffix}`,
        `X-RateLimit-Limit${suffix}`,
        `X-RateLimit-Remaining${suffix}`,
        `X-RateLimit-Reset${suffix}`,
      ];
    }),
  });

  const port = config.get<number>('PORT', 3000);

  configureApp(app);

  // Swagger: "hợp đồng" API cho FE. Mở tại /api/docs (FE build UI dựa trên đây).
  const swaggerConfig = new DocumentBuilder()
    .setTitle('LanCare Hub API')
    .setDescription('API xác thực & nghiệp vụ LanCare Hub')
    .setVersion('1.0')
    // addBearerAuth: cho phép dán access token vào Swagger UI để gọi thử endpoint cần đăng nhập.
    .addBearerAuth()
    .build();
  // Bảo vệ /api/docs bằng Basic Auth khi có cấu hình (prod). Thiếu env (local) → bỏ qua, vào thẳng.
  const swaggerUser = config.get<string>('SWAGGER_USER');
  const swaggerPassword = config.get<string>('SWAGGER_PASSWORD');
  if (swaggerUser && swaggerPassword) {
    const expected =
      'Basic ' +
      Buffer.from(`${swaggerUser}:${swaggerPassword}`).toString('base64');
    app.use(
      ['/api/docs', '/api/docs-json'],
      (
        req: { headers: Record<string, string | undefined> },
        res: {
          setHeader: (k: string, v: string) => void;
          status: (c: number) => { send: (b: string) => void };
        },
        next: () => void,
      ) => {
        if (safeEqual(req.headers.authorization ?? '', expected)) {
          return next();
        }
        res.setHeader('WWW-Authenticate', 'Basic realm="LanCare Docs"');
        res.status(401).send('Unauthorized');
      },
    );
  }

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  // Trên Vercel (serverless) static assets của swagger-ui không được bundle → load qua CDN.
  const swaggerCdn = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5';
  SwaggerModule.setup(
    'api/docs',
    app,
    document,
    process.env.VERCEL
      ? {
          customCssUrl: `${swaggerCdn}/swagger-ui.css`,
          customJs: [
            `${swaggerCdn}/swagger-ui-bundle.js`,
            `${swaggerCdn}/swagger-ui-standalone-preset.js`,
          ],
        }
      : undefined,
  );

  await app.listen(port);
  Logger.log(
    `LanCare Hub API listening on http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
  Logger.log(`Swagger docs: http://localhost:${port}/api/docs`, 'Bootstrap');
}
// So sánh constant-time — chống dò mật khẩu Swagger qua thời gian phản hồi.
function safeEqual(received: string, expected: string): boolean {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

void bootstrap();
