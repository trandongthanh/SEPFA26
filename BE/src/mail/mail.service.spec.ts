import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createServer, type Server, type Socket } from 'net';
import type { AddressInfo } from 'net';
import { MailService } from './mail.service';

const makeService = (env: Record<string, unknown>) =>
  new MailService({
    get: (key: string) => env[key],
  } as unknown as ConfigService);

// Đọc field private để kiểm cấu hình mà không phải gửi mail thật.
const internals = (service: MailService) =>
  service as unknown as {
    from: string;
    transporter: { options: Record<string, unknown> } | null;
  };

const MAIL = { to: 'hoa@gmail.com', fullName: 'Hoa', password: 'Abc123xyz_-9' };

describe('MailService', () => {
  describe('cấu hình', () => {
    it('MAIL_FROM rỗng → lùi về SMTP_USER (không dùng chuỗi rỗng làm người gửi)', () => {
      const service = makeService({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'lancare@gmail.com',
        SMTP_PASS: 'x',
        MAIL_FROM: '',
      });
      expect(internals(service).from).toBe('lancare@gmail.com');
    });

    it('có MAIL_FROM thì dùng MAIL_FROM', () => {
      const service = makeService({
        SMTP_HOST: 'smtp.gmail.com',
        SMTP_USER: 'lancare@gmail.com',
        MAIL_FROM: 'LanCare <lancare@gmail.com>',
      });
      expect(internals(service).from).toBe('LanCare <lancare@gmail.com>');
    });

    it('đặt timeout SMTP ngắn (không dùng mặc định 2–10 phút của nodemailer)', () => {
      const service = makeService({ SMTP_HOST: 'smtp.gmail.com' });
      expect(internals(service).transporter?.options).toMatchObject({
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 15_000,
      });
    });

    it('SMTP_HOST rỗng → không tạo transporter, gửi mail trả false (không ném lỗi)', async () => {
      const service = makeService({ SMTP_HOST: '' });
      expect(internals(service).transporter).toBeNull();
      await expect(service.sendGooglePassword(MAIL)).resolves.toBe(false);
    });
  });

  describe('sendPasswordReset', () => {
    type SentMail = { to: string; text: string; html: string };
    const RESET = {
      to: 'hoa@gmail.com',
      fullName: '<b>Hoa</b>',
      token: 'abc+/=_-XYZ',
    };
    // Thay transporter thật bằng bản giả để đọc nội dung mail mà không gửi SMTP.
    const withFakeTransport = (env: Record<string, unknown>) => {
      const service = makeService({ SMTP_HOST: 'smtp.gmail.com', ...env });
      const sendMail = jest
        .fn<Promise<unknown>, [SentMail]>()
        .mockResolvedValue({});
      (service as unknown as { transporter: unknown }).transporter = {
        sendMail,
      };
      return { service, sendMail };
    };
    afterEach(() => jest.restoreAllMocks());

    it('link = APP_BASE_URL/auth/reset-password?token=<encode>, bỏ "/" cuối APP_BASE_URL', async () => {
      const { service, sendMail } = withFakeTransport({
        APP_BASE_URL: 'https://lancarehub.vn/',
      });
      await expect(service.sendPasswordReset(RESET)).resolves.toBe(true);
      const [mail] = sendMail.mock.calls[0];
      const url = `https://lancarehub.vn/auth/reset-password?token=${encodeURIComponent(RESET.token)}`;
      expect(mail.to).toBe('hoa@gmail.com');
      expect(mail.text).toContain(url);
      expect(mail.text).toContain('30 phút');
      // HTML escape cả tên (chống chèn HTML) lẫn link.
      expect(mail.html).toContain('&lt;b&gt;Hoa&lt;/b&gt;');
      expect(mail.html).not.toContain('<b>Hoa</b>');
      expect(mail.html).toContain(
        '/auth/reset-password?token=abc%2B%2F%3D_-XYZ',
      );
    });

    it('SMTP lỗi → trả false, không ném', async () => {
      const { service, sendMail } = withFakeTransport({});
      sendMail.mockRejectedValue(new Error('535 auth failed'));
      jest.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
      await expect(service.sendPasswordReset(RESET)).resolves.toBe(false);
    });

    it('không SMTP ở dev → ghi link ra log để thử tay', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const service = makeService({
        SMTP_HOST: '',
        NODE_ENV: 'development',
        APP_BASE_URL: 'http://localhost:3002',
      });
      await expect(service.sendPasswordReset(RESET)).resolves.toBe(false);
      expect(warn.mock.calls[0][0]).toContain(
        'http://localhost:3002/auth/reset-password?token=',
      );
    });

    it('không SMTP ở production → KHÔNG ghi link (link là chìa khoá đổi mật khẩu)', async () => {
      const warn = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => {});
      const service = makeService({ SMTP_HOST: '', NODE_ENV: 'production' });
      await expect(service.sendPasswordReset(RESET)).resolves.toBe(false);
      expect(warn.mock.calls[0][0]).not.toContain('token=');
    });
  });

  describe('SMTP treo', () => {
    let server: Server;
    const sockets: Socket[] = [];

    beforeAll(async () => {
      // Server nhận kết nối nhưng KHÔNG BAO GIỜ gửi lời chào SMTP — giả lập SMTP treo.
      server = createServer((socket) => sockets.push(socket));
      await new Promise<void>((resolve) => server.listen(0, resolve));
    });

    afterAll(async () => {
      sockets.forEach((socket) => socket.destroy());
      await new Promise((resolve) => server.close(resolve));
    });

    it('bỏ cuộc sau ~10s và trả false — không treo request theo SMTP', async () => {
      const { port } = server.address() as AddressInfo;
      const service = makeService({
        SMTP_HOST: '127.0.0.1',
        SMTP_PORT: port,
        SMTP_USER: 'u',
        SMTP_PASS: 'p',
      });

      const startedAt = Date.now();
      await expect(service.sendGooglePassword(MAIL)).resolves.toBe(false);
      const elapsed = Date.now() - startedAt;
      expect(elapsed).toBeGreaterThanOrEqual(9_000);
      expect(elapsed).toBeLessThan(16_000);
    }, 20_000);
  });
});
