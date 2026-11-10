import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Account } from '../accounts/entities/account.entity';
import { CryptoService } from '../crypto/crypto.service';
import { CustomerProfile } from '../customers/entities/customer-profile.entity';
import { ProviderProfile } from '../providers/entities/provider-profile.entity';
import {
  assertProviderIdentityComplete,
  buildPartySnapshot,
  readPartySnapshot,
} from './party-snapshot';

const CUSTOMER_CCCD = '001111111111';
const PROVIDER_CCCD = '002222222222';
const EKYC_CCCD = '003333333333';

describe('party-snapshot', () => {
  const crypto = new CryptoService({
    get: () => '0'.repeat(64),
  } as unknown as ConfigService);

  const account = (fullName: string, phone: string | null) =>
    Object.assign(new Account(), {
      fullName,
      phone: phone ? crypto.encrypt(phone) : null,
    });

  const customer = (patch: Partial<CustomerProfile> = {}) =>
    Object.assign(new CustomerProfile(), {
      account: account('Khách A', '0911222333'),
      address: '25 Lê Lợi',
      defaultPickupAddress: null,
      cccdNumber: crypto.encrypt(CUSTOMER_CCCD),
      cccdFrontUrl: 'https://x/c-front.jpg',
      cccdBackUrl: 'https://x/c-back.jpg',
      selfieWithIdUrl: 'https://x/c-selfie.jpg',
      ...patch,
    });

  const provider = (patch: Partial<ProviderProfile> = {}) =>
    Object.assign(new ProviderProfile(), {
      account: account('Chủ vườn B', '0909123456'),
      displayName: 'Vườn Lan B',
      address: '12 Nguyễn Văn Bảo',
      cccdNumber: crypto.encrypt(PROVIDER_CCCD),
      cccdFrontUrl: 'https://x/p-front.jpg',
      cccdBackUrl: 'https://x/p-back.jpg',
      ...patch,
    });

  describe('buildPartySnapshot', () => {
    it('v2: SĐT + CCCD 2 bên lưu dạng MÃ HOÁ — JSON snapshot không chứa bản rõ', () => {
      const snap = buildPartySnapshot(
        { customer: customer(), provider: provider() },
        crypto,
      );
      expect(snap.version).toBe(2);
      const json = JSON.stringify(snap);
      for (const plain of [
        CUSTOMER_CCCD,
        PROVIDER_CCCD,
        '0911222333',
        '0909123456',
      ]) {
        expect(json).not.toContain(plain);
      }
      expect(crypto.decrypt(snap.provider.identityNumberEnc!)).toBe(
        PROVIDER_CCCD,
      );
      expect(snap.customer.identityDocuments).toHaveLength(3);
      expect(snap.provider.identityDocuments).toHaveLength(2);
    });

    it('khách chưa khai CCCD trong hồ sơ → lấy bản eKYC', () => {
      const snap = buildPartySnapshot(
        {
          customer: customer({ cccdNumber: null }),
          provider: provider(),
          customerEkycIdNumberEnc: crypto.encrypt(EKYC_CCCD),
        },
        crypto,
      );
      expect(crypto.decrypt(snap.customer.identityNumberEnc!)).toBe(EKYC_CCCD);
    });

    it('dữ liệu seed cũ là bản rõ → vẫn được mã hoá khi vào snapshot', () => {
      const snap = buildPartySnapshot(
        {
          customer: customer({ cccdNumber: CUSTOMER_CCCD }),
          provider: provider(),
        },
        crypto,
      );
      expect(snap.customer.identityNumberEnc).not.toBe(CUSTOMER_CCCD);
      expect(crypto.decrypt(snap.customer.identityNumberEnc!)).toBe(
        CUSTOMER_CCCD,
      );
    });

    it('thiếu dữ liệu → null (mã hoá) / "Chưa cung cấp" (chữ)', () => {
      const snap = buildPartySnapshot(
        { customer: null, provider: null },
        crypto,
      );
      expect(snap.customer).toEqual({
        fullName: 'Chưa cung cấp',
        address: 'Chưa cung cấp',
        phoneEnc: null,
        identityNumberEnc: null,
        identityDocuments: [],
      });
    });
  });

  describe('readPartySnapshot', () => {
    it('v2 → giải mã, trả field phone/identityNumber (không còn *Enc)', () => {
      const snap = buildPartySnapshot(
        { customer: customer(), provider: provider() },
        crypto,
      );
      const parties = readPartySnapshot(snap, crypto)!;
      expect(parties.customer).toEqual({
        fullName: 'Khách A',
        address: '25 Lê Lợi',
        phone: '0911222333',
        identityNumber: CUSTOMER_CCCD,
        identityDocuments: [
          'https://x/c-front.jpg',
          'https://x/c-back.jpg',
          'https://x/c-selfie.jpg',
        ],
      });
      expect(parties.provider).toMatchObject({
        fullName: 'Chủ vườn B',
        phone: '0909123456',
        identityNumber: PROVIDER_CCCD,
      });
      expect(JSON.stringify(parties)).not.toContain('Enc');
    });

    it('v2 thiếu SĐT/CCCD → "Chưa cung cấp"', () => {
      const snap = buildPartySnapshot(
        { customer: null, provider: null },
        crypto,
      );
      expect(readPartySnapshot(snap, crypto)!.provider).toMatchObject({
        phone: 'Chưa cung cấp',
        identityNumber: 'Chưa cung cấp',
      });
    });

    it.each([
      ['snapshot cũ không version', { customer: { identityNumber: 'x' } }],
      ['undefined', undefined],
      ['null', null],
    ])('%s → null (caller tự xử lý, không backfill)', (_case, parties) => {
      expect(readPartySnapshot(parties, crypto)).toBeNull();
    });
  });

  describe('assertProviderIdentityComplete', () => {
    it('đủ SĐT + số CCCD → qua', () => {
      expect(() => assertProviderIdentityComplete(provider())).not.toThrow();
    });

    it.each([
      ['thiếu số CCCD', { cccdNumber: null }],
      ['thiếu SĐT', { account: account('Chủ vườn B', null) }],
    ])('%s → 403 PROVIDER_IDENTITY_INCOMPLETE', (_case, patch) => {
      expect(() =>
        assertProviderIdentityComplete(
          provider(patch as Partial<ProviderProfile>),
        ),
      ).toThrow(new ForbiddenException('PROVIDER_IDENTITY_INCOMPLETE'));
    });
  });
});
