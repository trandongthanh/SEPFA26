import {
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';
import { GoogleIdTokenVerifier } from './google-id-token.verifier';

const makeVerifier = (clientIds = 'web-client-id, mobile-client-id') =>
  new GoogleIdTokenVerifier({
    get: (name: string) =>
      name === 'GOOGLE_CLIENT_IDS' ? clientIds : undefined,
  } as unknown as ConfigService);

const CERTS = { kid1: 'public-key' };

// Bước 1 (mạng): tải khoá công khai Google.
const mockCerts = () =>
  jest
    .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
    .mockResolvedValue({ certs: CERTS } as never);

// Bước 2 (tại chỗ): kiểm chữ ký/iss/exp/aud rồi trả payload.
const mockPayload = (payload: Partial<TokenPayload> | undefined) =>
  jest
    .spyOn(OAuth2Client.prototype, 'verifySignedJwtWithCertsAsync')
    .mockResolvedValue({ getPayload: () => payload } as never);

describe('GoogleIdTokenVerifier', () => {
  afterEach(() => jest.restoreAllMocks());

  it('trả email (chữ thường) + tên; kiểm aud theo đủ danh sách client ID và issuer Google', async () => {
    mockCerts();
    const verifySpy = mockPayload({
      email: 'Hoa@Gmail.com',
      email_verified: true,
      name: ' Trần Thị Hoa ',
    });

    await expect(makeVerifier().verify('id-token')).resolves.toEqual({
      email: 'hoa@gmail.com',
      fullName: 'Trần Thị Hoa',
    });
    expect(verifySpy).toHaveBeenCalledWith(
      'id-token',
      CERTS,
      ['web-client-id', 'mobile-client-id'],
      ['accounts.google.com', 'https://accounts.google.com'],
    );
  });

  it('không có name → lấy phần trước @ làm tên', async () => {
    mockCerts();
    mockPayload({ email: 'hoa@gmail.com', email_verified: true });
    await expect(makeVerifier().verify('t')).resolves.toMatchObject({
      fullName: 'hoa',
    });
  });

  it('tên dài > 150 ký tự bị cắt còn 150 (tránh lỗi 500 khi lưu DB)', async () => {
    mockCerts();
    mockPayload({
      email: 'hoa@gmail.com',
      email_verified: true,
      name: 'A'.repeat(300),
    });
    const profile = await makeVerifier().verify('t');
    expect(profile.fullName).toHaveLength(150);
  });

  it('503 GOOGLE_AUTH_NOT_CONFIGURED khi chưa cấu hình client ID', async () => {
    const certsSpy = mockCerts();
    await expect(makeVerifier('').verify('t')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(certsSpy).not.toHaveBeenCalled();
  });

  it('503 GOOGLE_AUTH_UNAVAILABLE (không phải 401) khi không tải được khoá Google — lỗi mạng', async () => {
    jest
      .spyOn(OAuth2Client.prototype, 'getFederatedSignonCertsAsync')
      .mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const verifySpy = mockPayload({});

    await expect(makeVerifier().verify('t')).rejects.toThrow(
      new ServiceUnavailableException('GOOGLE_AUTH_UNAVAILABLE'),
    );
    expect(verifySpy).not.toHaveBeenCalled();
  });

  it('401 INVALID_GOOGLE_TOKEN khi token sai (chữ ký/hạn/aud)', async () => {
    mockCerts();
    jest
      .spyOn(OAuth2Client.prototype, 'verifySignedJwtWithCertsAsync')
      .mockRejectedValue(new Error('Wrong recipient'));
    await expect(makeVerifier().verify('t')).rejects.toThrow(
      new UnauthorizedException('INVALID_GOOGLE_TOKEN'),
    );
  });

  it('401 INVALID_GOOGLE_TOKEN khi payload không có email', async () => {
    mockCerts();
    mockPayload({ sub: '123' });
    await expect(makeVerifier().verify('t')).rejects.toThrow(
      new UnauthorizedException('INVALID_GOOGLE_TOKEN'),
    );
  });

  it('401 GOOGLE_EMAIL_NOT_VERIFIED khi email chưa xác minh', async () => {
    mockCerts();
    mockPayload({ email: 'hoa@gmail.com', email_verified: false });
    await expect(makeVerifier().verify('t')).rejects.toThrow(
      new UnauthorizedException('GOOGLE_EMAIL_NOT_VERIFIED'),
    );
  });
});
