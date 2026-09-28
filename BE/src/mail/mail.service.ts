import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

const SMTP_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;

export interface GooglePasswordMail {
  to: string;
  fullName: string;
  password: string;
}

/**
 * Gửi mail qua SMTP (nodemailer). Thiếu cấu hình SMTP (dev/test) → chỉ log cảnh báo,
 * không ném lỗi: gửi mail là phụ, không được làm hỏng luồng nghiệp vụ gọi nó.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string;
  private readonly appBaseUrl: string;

  constructor(config: ConfigService) {
    // Chuỗi rỗng trong .env (vd `MAIL_FROM=`) coi như chưa cấu hình → dùng `||`, không dùng `??`.
    const host = config.get<string>('SMTP_HOST') || '';
    const port = Number(config.get<number>('SMTP_PORT') || 587);
    const user = config.get<string>('SMTP_USER') || '';
    this.transporter = host
      ? createTransport({
          host,
          port,
          // 465 = TLS ngay từ đầu; 587 = STARTTLS.
          secure: port === 465,
          auth: { user, pass: config.get<string>('SMTP_PASS') || '' },
          // Mặc định nodemailer chờ tới 2 phút (kết nối) / 10 phút (socket) — request
          // đăng ký Google đang chờ mail sẽ treo theo. Quá hạn → bỏ qua mail, ghi log.
          connectionTimeout: SMTP_TIMEOUT_MS,
          greetingTimeout: SMTP_TIMEOUT_MS,
          socketTimeout: SMTP_SOCKET_TIMEOUT_MS,
        })
      : null;
    this.from =
      config.get<string>('MAIL_FROM') || user || 'no-reply@lancarehub.vn';
    // Có SMTP thì env.validation bắt buộc APP_BASE_URL → link trong mail luôn tuyệt đối.
    this.appBaseUrl = (config.get<string>('APP_BASE_URL') || '').replace(
      /\/$/,
      '',
    );
  }

  // Mail gửi mật khẩu tự sinh khi tài khoản được tạo bằng Google.
  // Trả true nếu gửi thành công; mọi lỗi (SMTP sai, timeout) đều nuốt + log, không ném.
  // Caller AWAIT hàm này (không chạy nền) vì trên Vercel serverless tác vụ nền có thể bị
  // huỷ ngay sau khi trả response → đổi lại request chậm thêm ~4s với Gmail.
  async sendGooglePassword(mail: GooglePasswordMail): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(
        `SMTP chưa cấu hình — bỏ qua mail mật khẩu cho ${mail.to}`,
      );
      return false;
    }
    const changePasswordUrl = `${this.appBaseUrl}/account/change-password`;
    try {
      await this.transporter.sendMail({
        from: this.from,
        to: mail.to,
        subject: 'LanCare Hub — Mật khẩu đăng nhập tài khoản của bạn',
        text: [
          `Xin chào ${mail.fullName},`,
          'Tài khoản LanCare Hub của bạn đã được tạo bằng Google.',
          'Bạn có thể đăng nhập bằng Google, hoặc bằng email và mật khẩu dưới đây:',
          `Email: ${mail.to}`,
          `Mật khẩu: ${mail.password}`,
          `Đổi mật khẩu: ${changePasswordUrl}`,
        ].join('\n'),
        html: this.googlePasswordHtml(mail, changePasswordUrl),
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Gửi mail mật khẩu cho ${mail.to} thất bại: ${(err as Error).message}`,
      );
      return false;
    }
  }

  private googlePasswordHtml(mail: GooglePasswordMail, url: string): string {
    const name = escapeHtml(mail.fullName);
    const email = escapeHtml(mail.to);
    const password = escapeHtml(mail.password);
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1b2e">
  <h2 style="color:#6027D2">LanCare Hub</h2>
  <p>Xin chào <b>${name}</b>,</p>
  <p>Tài khoản LanCare Hub của bạn đã được tạo bằng Google. Bạn có thể đăng nhập bằng Google,
     hoặc bằng email và mật khẩu dưới đây:</p>
  <table style="background:#F3E8FF;border-radius:8px;padding:12px 16px">
    <tr><td>Email:</td><td><b>${email}</b></td></tr>
    <tr><td>Mật khẩu:</td><td><b style="font-family:monospace;font-size:16px">${password}</b></td></tr>
  </table>
  <p>Nên đổi mật khẩu này sau khi đăng nhập:</p>
  <p><a href="${url}" style="background:#6027D2;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Đổi mật khẩu</a></p>
</div>`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
