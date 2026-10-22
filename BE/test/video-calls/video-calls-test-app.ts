import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/app.setup';
import { GoogleIdTokenVerifier } from '../../src/auth/google-id-token.verifier';
import { MailService } from '../../src/mail/mail.service';
import { StreamVideoClient } from '../../src/video-calls/stream-video.client';
import { FakeGoogleVerifier, FakeMailService } from '../auth-test-app';
import { FakeStreamVideoClient } from './fake-stream-video.client';

export interface VideoCallsTestApp {
  app: INestApplication;
  dataSource: DataSource;
  stream: FakeStreamVideoClient;
  reset: () => Promise<void>;
}

/**
 * Bộ dựng e2e riêng của video call (K15, P23) — không sửa test/auth-test-app.ts, chỉ import
 * Google/mail giả từ đó. GetStream thay bằng bản giả; rawBody bật như main.ts (webhook, X1).
 * Chạy e2e TUẦN TỰ: `npm run test:e2e -- --runInBand` (2 suite dùng chung DB test).
 */
export async function createVideoCallsTestApp(): Promise<VideoCallsTestApp> {
  const dbName = process.env.DB_NAME ?? '';
  // Chốt an toàn: bài test XOÁ SẠCH schema — tuyệt đối không chạy trên DB không phải test.
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `E2E từ chối chạy trên DB "${dbName}" (phải kết thúc bằng _test)`,
    );
  }

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleIdTokenVerifier)
    .useValue(new FakeGoogleVerifier())
    .overrideProvider(MailService)
    .useValue(new FakeMailService())
    .overrideProvider(StreamVideoClient)
    .useFactory({
      // ConfigService của app (đã qua schema Joi → có mặc định STREAM_CALL_TYPE...).
      factory: (config: ConfigService) => new FakeStreamVideoClient(config),
      inject: [ConfigService],
    })
    .compile();

  const app = moduleRef.createNestApplication({ rawBody: true });
  configureApp(app);
  // Listen tường minh trên 127.0.0.1 (lý do: xem test/auth-test-app.ts).
  await app.listen(0, '127.0.0.1');

  const dataSource = app.get(DataSource);
  await dataSource.synchronize(true); // drop + tạo lại toàn bộ bảng

  const stream = app.get(StreamVideoClient);
  if (!(stream instanceof FakeStreamVideoClient)) {
    throw new Error('E2E phải dùng GetStream giả');
  }

  return {
    app,
    dataSource,
    stream,
    reset: async () => {
      stream.reset();
      // CASCADE: hồ sơ, gói, đơn, cuộc gọi đều trỏ về accounts.
      await dataSource.query('TRUNCATE TABLE refresh_tokens, accounts CASCADE');
    },
  };
}
