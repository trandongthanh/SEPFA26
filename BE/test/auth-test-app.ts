import { INestApplication, UnauthorizedException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import {
  GoogleIdTokenVerifier,
  type GoogleProfile,
} from '../src/auth/google-id-token.verifier';
import {
  MailService,
  type GooglePasswordMail,
  type PasswordResetMail,
} from '../src/mail/mail.service';

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

  // Mail đặt lại mật khẩu — lưu token thô để test lấy ra như người dùng bấm link.
  readonly resetMails: PasswordResetMail[] = [];
  sendPasswordReset(mail: PasswordResetMail): Promise<boolean> {
    if (this.failing) {
      return Promise.resolve(false);
    }
    this.resetMails.push(mail);
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
  // Cùng cấu hình với main.ts → hành vi validate/route/serialize khớp production.
  configureApp(app);
  // Listen TƯỜNG MINH trên 127.0.0.1 (thay vì để supertest tự listen(0) trên `::`).
  // macOS cho bind `::` trùng port mà tiến trình khác (VS Code, Postman...) đang giữ trên
  // 127.0.0.1 → supertest gọi 127.0.0.1:port rơi vào server KHÁC → test chập chờn 404/401.
  await app.listen(0, '127.0.0.1');

  const dataSource = app.get(DataSource);
  await dataSource.synchronize(true); // drop + tạo lại toàn bộ bảng

  return {
    app,
    dataSource,
    mailbox,
    reset: async () => {
      mailbox.sent.length = 0;
      mailbox.resetMails.length = 0;
      mailbox.failing = false;
      await dataSource.query('TRUNCATE TABLE refresh_tokens, accounts CASCADE');
    },
  };
}
