import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTransport, type Transporter } from 'nodemailer';

const SMTP_TIMEOUT_MS = 10_000;
const SMTP_SOCKET_TIMEOUT_MS = 15_000;
// Hạn link đặt lại mật khẩu — nguồn duy nhất: AuthService dùng để đặt expires_at, mail in ra cho người dùng.
export const PASSWORD_RESET_LINK_MINUTES = 30;
export const REGISTER_OTP_MINUTES = 5;
export const RESET_PASSWORD_OTP_MINUTES = 10;

export interface GooglePasswordMail {
  to: string;
  fullName: string;
  password: string;
}

export interface PasswordResetMail {
  to: string;
  fullName: string;
  token: string; // token thô — chỉ xuất hiện trong link của mail này
}

export interface EmailOtpMail {
  to: string;
  fullName?: string;
  otp: string;
  expiresMinutes: number;
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
  private readonly isProduction: boolean;
  private readonly resendApiKey: string | null;

  constructor(config: ConfigService) {
    // Chuỗi rỗng trong .env (vd `MAIL_FROM=`) coi như chưa cấu hình → dùng `||`, không dùng `??`.
    const host = config.get<string>('SMTP_HOST') || '';
    const port = Number(config.get<number>('SMTP_PORT') || 587);
    const user = config.get<string>('SMTP_USER') || '';
    const pass = config.get<string>('SMTP_PASS') || '';

    // Nếu cấu hình Resend (API key bắt đầu bằng re_ hoặc host là smtp.resend.com), gửi qua HTTPS REST API để không bị ISP chặn cổng SMTP
    this.resendApiKey =
      pass.startsWith('re_') || host.includes('resend.com') ? pass : null;

    this.transporter =
      host && !this.resendApiKey
        ? createTransport({
            host,
            port,
            // 465 = TLS ngay từ đầu; 587 = STARTTLS.
            secure: port === 465,
            auth: { user, pass },
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
    this.isProduction = config.get<string>('NODE_ENV') === 'production';
  }

  /** Gửi email qua Resend REST API (cổng 443 HTTPS chống chặn cổng) hoặc qua Nodemailer SMTP */
  private async dispatchEmail(options: {
    to: string;
    subject: string;
    text: string;
    html: string;
    logLabel: string;
  }): Promise<boolean> {
    if (this.resendApiKey) {
      try {
        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: this.from,
            to: [options.to],
            subject: options.subject,
            text: options.text,
            html: options.html,
          }),
        });

        if (!response.ok) {
          const errData = await response.json().catch(() => ({}));
          this.logger.error(
            `Resend API gửi mail ${options.logLabel} cho ${options.to} thất bại: ${JSON.stringify(errData)}`,
          );
          return false;
        }

        return true;
      } catch (err) {
        this.logger.error(
          `Resend API lỗi gửi mail cho ${options.to}: ${(err as Error).message}`,
        );
        return false;
      }
    }

    if (!this.transporter) {
      this.logger.warn(
        this.isProduction
          ? `SMTP chưa cấu hình — bỏ qua mail ${options.logLabel} cho ${options.to}`
          : `SMTP chưa cấu hình — ${options.logLabel} cho ${options.to}`,
      );
      return false;
    }

    try {
      await this.transporter.sendMail({
        from: this.from,
        to: options.to,
        subject: options.subject,
        text: options.text,
        html: options.html,
      });
      return true;
    } catch (err) {
      this.logger.error(
        `Gửi mail ${options.logLabel} cho ${options.to} thất bại: ${(err as Error).message}`,
      );
      return false;
    }
  }

  // Mail đặt lại mật khẩu (POST /auth/forgot-password). Link trỏ trang web FE
  // `${APP_BASE_URL}/auth/reset-password?token=...` (cùng nhóm /auth/* với trang login/register của FE)
  // — FE đọc token rồi gọi POST /api/v1/auth/reset-password.
  // Nuốt mọi lỗi như sendGooglePassword. Thiếu SMTP ở dev/test → ghi link ra log để thử tay;
  // production KHÔNG ghi (link là chìa khoá đổi mật khẩu).
  async sendPasswordReset(mail: PasswordResetMail): Promise<boolean> {
    const resetUrl = `${this.appBaseUrl}/auth/reset-password?token=${encodeURIComponent(mail.token)}`;
    if (!this.resendApiKey && !this.transporter) {
      this.logger.warn(
        this.isProduction
          ? `SMTP chưa cấu hình — bỏ qua mail đặt lại mật khẩu cho ${mail.to}`
          : `SMTP chưa cấu hình — link đặt lại mật khẩu cho ${mail.to}: ${resetUrl}`,
      );
      return false;
    }
    return this.dispatchEmail({
      to: mail.to,
      subject: 'LanCare Hub — Đặt lại mật khẩu',
      text: [
        `Xin chào ${mail.fullName},`,
        'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản LanCare Hub của bạn.',
        `Đặt lại mật khẩu (link hết hạn sau ${PASSWORD_RESET_LINK_MINUTES} phút, dùng 1 lần): ${resetUrl}`,
        'Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.',
      ].join('\n'),
      html: this.passwordResetHtml(mail, resetUrl),
      logLabel: 'đặt lại mật khẩu',
    });
  }

  // Mail gửi mật khẩu tự sinh khi tài khoản được tạo bằng Google.
  // Trả true nếu gửi thành công; mọi lỗi (SMTP sai, timeout) đều nuốt + log, không ném.
  // Caller AWAIT hàm này (không chạy nền) vì trên Vercel serverless tác vụ nền có thể bị
  // huỷ ngay sau khi trả response → đổi lại request chậm thêm ~4s với Gmail.
  async sendGooglePassword(mail: GooglePasswordMail): Promise<boolean> {
    if (!this.resendApiKey && !this.transporter) {
      this.logger.warn(
        `SMTP chưa cấu hình — bỏ qua mail mật khẩu cho ${mail.to}`,
      );
      return false;
    }
    const changePasswordUrl = `${this.appBaseUrl}/account/change-password`;
    return this.dispatchEmail({
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
      logLabel: 'mật khẩu Google',
    });
  }

  async sendRegistrationOtp(mail: EmailOtpMail): Promise<boolean> {
    return this.sendOtpEmail(mail, {
      subject: 'LanCare Hub — Mã OTP xác thực đăng ký tài khoản',
      title: 'Xác thực đăng ký tài khoản',
      intro:
        'Vui lòng nhập mã OTP 6 chữ số dưới đây để hoàn tất xác thực email đăng ký tài khoản LanCare Hub:',
      logLabel: 'OTP đăng ký',
    });
  }

  async sendEmailVerificationOtp(mail: EmailOtpMail): Promise<boolean> {
    return this.sendOtpEmail(mail, {
      subject: 'LanCare Hub — Mã OTP xác thực địa chỉ email',
      title: 'Xác thực địa chỉ email',
      intro:
        'Vui lòng nhập mã OTP 6 chữ số dưới đây để xác thực quyền sở hữu email cho tài khoản LanCare Hub của bạn:',
      logLabel: 'OTP xác thực email',
    });
  }

  async sendPasswordResetOtp(mail: EmailOtpMail): Promise<boolean> {
    return this.sendOtpEmail(mail, {
      subject: 'LanCare Hub — Mã OTP đặt lại mật khẩu',
      title: 'Đặt lại mật khẩu qua mã OTP',
      intro:
        'Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản LanCare Hub của bạn. Sử dụng mã OTP 6 chữ số sau:',
      logLabel: 'OTP đặt lại mật khẩu',
    });
  }

  private async sendOtpEmail(
    mail: EmailOtpMail,
    meta: { subject: string; title: string; intro: string; logLabel: string },
  ): Promise<boolean> {
    if (!this.resendApiKey && !this.transporter) {
      this.logger.warn(
        this.isProduction
          ? `SMTP chưa cấu hình — bỏ qua mail ${meta.logLabel} cho ${mail.to}`
          : `SMTP chưa cấu hình — ${meta.logLabel} cho ${mail.to}: ${mail.otp} (hết hạn sau ${mail.expiresMinutes} phút)`,
      );
      return false;
    }
    const greetingName = mail.fullName?.trim() || 'bạn';
    return this.dispatchEmail({
      to: mail.to,
      subject: meta.subject,
      text: [
        `Xin chào ${greetingName},`,
        meta.intro,
        `Mã OTP: ${mail.otp}`,
        `Mã có hiệu lực trong ${mail.expiresMinutes} phút và chỉ dùng được 1 lần. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.`,
      ].join('\n'),
      html: this.otpEmailHtml(mail, meta.title, meta.intro),
      logLabel: meta.logLabel,
    });
  }

  private otpEmailHtml(
    mail: EmailOtpMail,
    title: string,
    intro: string,
  ): string {
    const name = escapeHtml(mail.fullName?.trim() || 'bạn');
    const otp = escapeHtml(mail.otp);
    const safeTitle = escapeHtml(title);
    const safeIntro = escapeHtml(intro);
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1b2e">
  <h2 style="color:#6027D2">LanCare Hub — ${safeTitle}</h2>
  <p>Xin chào <b>${name}</b>,</p>
  <p>${safeIntro}</p>
  <div style="background:#F3E8FF;border-radius:10px;padding:16px;text-align:center;margin:16px 0">
    <span style="font-family:monospace;font-size:28px;font-weight:bold;letter-spacing:6px;color:#6027D2">${otp}</span>
  </div>
  <p style="color:#6b6880;font-size:13px">Mã OTP có hiệu lực trong <b>${mail.expiresMinutes} phút</b> và chỉ dùng được 1 lần.
     Tuyệt đối không chia sẻ mã này cho bất kỳ ai. Nếu bạn không yêu cầu, hãy bỏ qua email này.</p>
</div>`;
  }

  private passwordResetHtml(mail: PasswordResetMail, url: string): string {
    const name = escapeHtml(mail.fullName);
    const href = escapeHtml(url);
    return `
<div style="font-family:Arial,sans-serif;max-width:520px;margin:auto;color:#1f1b2e">
  <h2 style="color:#6027D2">LanCare Hub</h2>
  <p>Xin chào <b>${name}</b>,</p>
  <p>Chúng tôi nhận được yêu cầu đặt lại mật khẩu cho tài khoản LanCare Hub của bạn.</p>
  <p><a href="${href}" style="background:#6027D2;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none">Đặt lại mật khẩu</a></p>
  <p style="color:#6b6880;font-size:13px">Link hết hạn sau ${PASSWORD_RESET_LINK_MINUTES} phút và chỉ dùng được 1 lần.
     Nếu bạn không yêu cầu, hãy bỏ qua email này — mật khẩu hiện tại vẫn giữ nguyên.</p>
</div>`;
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
