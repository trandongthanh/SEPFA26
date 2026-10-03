import {
  INestApplication,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import {
  GoogleIdTokenVerifier,
  type GoogleProfile,
} from '../src/auth/google-id-token.verifier';
import { MailService, type GooglePasswordMail } from '../src/mail/mail.service';

/**
 * Google giả: idToken dạng "google:<email>:<tên>" → profile; "google-unverified:<email>"
 * → email chưa xác minh; còn lại → token sai. Logic xác minh thật của Google nằm ở
 * google-id-token.verifier.spec.ts (unit test).
 */
export class FakeGoogleVerifier {
  verify(idToken: string): Promise<GoogleProfile> {
    const [kind, email, fullName] = idToken.split(':');
    if (kind === 'google' && email) {
      return Promise.resolve({
        email: email.toLowerCase(),
        fullName: fullName ?? email.split('@')[0],
      });
    }
    if (kind === 'google-unverified') {
      return Promise.reject(
        new UnauthorizedException('GOOGLE_EMAIL_NOT_VERIFIED'),
      );
    }
    return Promise.reject(new UnauthorizedException('INVALID_GOOGLE_TOKEN'));
  }
}

// Hộp thư giả: ghi lại mail thay vì gửi SMTP.
export class FakeMailService {
  readonly sent: GooglePasswordMail[] = [];
  // Bật để giả lập SMTP lỗi (MailService thật nuốt lỗi và trả false).
  failing = false;
  sendGooglePassword(mail: GooglePasswordMail): Promise<boolean> {
    if (this.failing) {
      return Promise.resolve(false);
    }
    this.sent.push(mail);
    return Promise.resolve(true);
  }
}

export interface AuthTestApp {
  app: INestApplication;
  dataSource: DataSource;
  mailbox: FakeMailService;
  reset: () => Promise<void>;
}

export async function createAuthTestApp(): Promise<AuthTestApp> {
  const dbName = process.env.DB_NAME ?? '';
  // Chốt an toàn: bài test XOÁ SẠCH schema — tuyệt đối không chạy trên DB không phải test.
  if (!dbName.endsWith('_test')) {
    throw new Error(
      `E2E từ chối chạy trên DB "${dbName}" (phải kết thúc bằng _test)`,
    );
  }

  const mailbox = new FakeMailService();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(GoogleIdTokenVerifier)
    .useValue(new FakeGoogleVerifier())
    .overrideProvider(MailService)
    .useValue(mailbox)
    .compile();

  const app = moduleRef.createNestApplication();
  // Giống main.ts để hành vi validate/route khớp production.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api/v1');
  await app.init();

  const dataSource = app.get(DataSource);
  await dataSource.synchronize(true); // drop + tạo lại toàn bộ bảng

  return {
    app,
    dataSource,
    mailbox,
    reset: async () => {
      mailbox.sent.length = 0;
      mailbox.failing = false;
      await dataSource.query('TRUNCATE TABLE refresh_tokens, accounts CASCADE');
    },
  };
}
