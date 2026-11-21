import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { envValidationSchema } from '../../config/env.validation';
import {
  STREAM_DURATION_BUFFER_SECONDS,
  STREAM_SETUP_TIMEOUT_MS,
} from '../video-call.constants';
import {
  checkCallTypeGrants,
  STREAM_CLIENT_TIMEOUT_MS,
  StreamVideoClient,
} from '../stream-video.client';

/**
 * K7: cấu hình app GetStream cho video call — role toàn app lancare_user, call type riêng
 * (STREAM_CALL_TYPE) với quyền tối thiểu, user hệ thống. Chạy lại nhiều lần an toàn.
 * App GetStream mới (vd app deploy) phải chạy 1 lần, không thì POST /video-calls trả 502.
 * Chạy (thư mục BE, đọc .env như khi chạy BE; không kết nối DB):
 *   npx ts-node -r tsconfig-paths/register src/video-calls/scripts/setup-stream-call-type.ts
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false, allowUnknown: true },
    }),
  ],
  providers: [
    StreamVideoClient,
    // P26: lệnh quản trị chạy tay, không giữ khóa DB → timeout 15 giây (PUT call type > 3 giây).
    { provide: STREAM_CLIENT_TIMEOUT_MS, useValue: STREAM_SETUP_TIMEOUT_MS },
  ],
})
class SetupStreamCallTypeModule {}

async function setupStreamCallType(): Promise<void> {
  const app = await NestFactory.createApplicationContext(
    SetupStreamCallTypeModule,
    { logger: ['error', 'warn'] },
  );
  try {
    const config = app.get(ConfigService);
    const stream = app.get(StreamVideoClient);

    // K3b (P20): GetStream cắt sau BE → BE luôn là bên kết thúc (TIMEOUT).
    const maxDurationSeconds =
      Number(config.getOrThrow('VIDEO_CALL_MAX_DURATION_SECONDS')) +
      Number(config.getOrThrow('VIDEO_CALL_RING_TIMEOUT_SECONDS')) +
      STREAM_DURATION_BUFFER_SECONDS;

    const result = await stream.ensureCallType(maxDurationSeconds);
    console.log(
      `Role lancare_user: ${result.appRoleCreated ? 'vừa tạo' : 'đã có'}`,
    );
    console.log(
      `Call type ${stream.callType}: ${result.callTypeCreated ? 'vừa tạo' : 'đã cập nhật'} (thời lượng tối đa ${maxDurationSeconds} giây)`,
    );
    console.log(`User hệ thống ${stream.systemUserId}: đã đăng ký (admin)`);

    // K1b, P27: đọc lại grants trên GetStream, so với grants mong muốn.
    for (const { ok, line } of checkCallTypeGrants(result.grants)) {
      if (!ok) {
        process.exitCode = 1;
      }
      console.log(line);
    }

    if (result.callTypeCreated) {
      console.log(
        'Vừa tạo call type: chờ ~10 giây cho GetStream lan cấu hình rồi mới thử gọi.',
      );
    }
  } finally {
    await app.close();
  }
}

setupStreamCallType().catch((err: unknown) => {
  new Logger('SetupStreamCallType').error(
    err instanceof Error ? err.message : String(err),
  );
  process.exitCode = 1;
});
