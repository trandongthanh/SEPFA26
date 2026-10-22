import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  OAuth2Client,
  type Certificates,
  type TokenPayload,
} from 'google-auth-library';

// Issuer hợp lệ của Google ID token.
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

// Khớp giới hạn fullName của đăng ký thường (RegisterDto) — cột DB là varchar(255).
const FULL_NAME_MAX_LENGTH = 150;

export interface GoogleProfile {
  email: string;
  fullName: string;
}

/**
 * Xác minh Google ID token do FE/Mobile lấy được (Google Identity Services / Google Sign-In).
 * Tách 2 bước để phân biệt lỗi:
 * - tải khoá công khai của Google (qua mạng, thư viện tự cache) lỗi → 503: lỗi hệ thống, không phải lỗi người dùng;
 * - kiểm chữ ký, iss, exp, aud ∈ GOOGLE_CLIENT_IDS (tại chỗ) lỗi → 401: token sai.
 */
@Injectable()
export class GoogleIdTokenVerifier {
  private readonly logger = new Logger(GoogleIdTokenVerifier.name);
  private readonly client = new OAuth2Client();
  private readonly audiences: string[];

  constructor(config: ConfigService) {
    this.audiences = (config.get<string>('GOOGLE_CLIENT_IDS') ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (this.audiences.length === 0) {
      throw new ServiceUnavailableException('GOOGLE_AUTH_NOT_CONFIGURED');
    }

    let certs: Certificates;
    try {
      ({ certs } = await this.client.getFederatedSignonCertsAsync());
    } catch (err) {
      this.logger.error(
        `Không tải được khoá công khai Google: ${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('GOOGLE_AUTH_UNAVAILABLE');
    }

    let payload: TokenPayload | undefined;
    try {
      const ticket = await this.client.verifySignedJwtWithCertsAsync(
        idToken,
        certs,
        this.audiences,
        GOOGLE_ISSUERS,
      );
      payload = ticket.getPayload();
    } catch {
      throw new UnauthorizedException('INVALID_GOOGLE_TOKEN');
    }
    if (!payload?.email) {
      throw new UnauthorizedException('INVALID_GOOGLE_TOKEN');
    }
    // Chỉ tin email Google đã xác minh — tài khoản tìm theo email.
    if (payload.email_verified !== true) {
      throw new UnauthorizedException('GOOGLE_EMAIL_NOT_VERIFIED');
    }
    const email = payload.email.toLowerCase().trim();
    const fullName = payload.name?.trim() || email.split('@')[0];
    return {
      email,
      fullName: fullName.slice(0, FULL_NAME_MAX_LENGTH),
    };
  }
}
