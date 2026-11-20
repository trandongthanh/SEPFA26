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
      dateOfBirth: '15/05/1992',
      placeOfOrigin: 'Quận 1, TP.HCM',
      address: '25 Lê Lợi',
      defaultPickupAddress: null,
      ...patch,
    });

  const provider = (patch: Partial<ProviderProfile> = {}) =>
    Object.assign(new ProviderProfile(), {
      account: account('Chủ vườn B', '0909123456'),
      displayName: 'Vườn Lan B',
      dateOfBirth: '20/10/1985',
      placeOfOrigin: 'TP. Bảo Lộc, Lâm Đồng',
      address: '12 Nguyễn Văn Bảo',
      ...patch,
    });

  describe('buildPartySnapshot', () => {
    it('v3: SĐT 2 bên lưu dạng MÃ HOÁ, không chứa số CCCD hay ảnh giấy tờ', () => {
      const snap = buildPartySnapshot(
        { customer: customer(), provider: provider() },
        crypto,
      );
      expect(snap.version).toBe(3);
      const json = JSON.stringify(snap);
      for (const forbidden of [
        '0911222333',
        '0909123456',
        'identityNumber',
        'identityDocuments',
      ]) {
        expect(json).not.toContain(forbidden);
      }
      expect(snap.customer.dateOfBirth).toBe('15/05/1992');
      expect(snap.customer.placeOfOrigin).toBe('Quận 1, TP.HCM');
      expect(snap.provider.dateOfBirth).toBe('20/10/1985');
      expect(snap.provider.placeOfOrigin).toBe('TP. Bảo Lộc, Lâm Đồng');
    });

    it('khách chưa khai trên hồ sơ → fallback bản đọc từ eKYC (không bao gồm số CCCD)', () => {
      const snap = buildPartySnapshot(
        {
          customer: customer({
            dateOfBirth: null,
            placeOfOrigin: null,
            address: null,
          }),
          provider: provider(),
          customerEkyc: {
            fullNameExtracted: 'KHÁCH EKYC',
            dateOfBirth: '01/01/1990',
            placeOfOrigin: 'Hà Nội',
            placeOfResidence: '10 Hoàng Diệu',
          },
        },
        crypto,
      );
      expect(snap.customer.dateOfBirth).toBe('01/01/1990');
      expect(snap.customer.placeOfOrigin).toBe('Hà Nội');
      expect(snap.customer.address).toBe('10 Hoàng Diệu');
    });

    it('dữ liệu seed cũ là bản rõ → vẫn được mã hoá khi vào snapshot', () => {
      const snap = buildPartySnapshot(
        {
          customer: customer({ account: account('Khách A', '0911222333') }),
          provider: provider({
            account: Object.assign(new Account(), {
              fullName: 'Chủ vườn B',
              phone: '0909123456',
            }),
          }),
        },
        crypto,
      );
      expect(snap.provider.phoneEnc).not.toBe('0909123456');
      expect(crypto.decrypt(snap.provider.phoneEnc!)).toBe('0909123456');
    });

    it('thiếu dữ liệu → null (mã hoá) / "Chưa cung cấp" (chữ)', () => {
      const snap = buildPartySnapshot(
        { customer: null, provider: null },
        crypto,
      );
      expect(snap.customer).toEqual({
        fullName: 'Chưa cung cấp',
        dateOfBirth: null,
        placeOfOrigin: null,
        address: 'Chưa cung cấp',
        phoneEnc: null,
      });
    });
  });

  describe('readPartySnapshot', () => {
    it('v3 → giải mã SĐT, trả 5 trường hợp lệ (không còn *Enc, không còn CCCD/ảnh)', () => {
      const snap = buildPartySnapshot(
        { customer: customer(), provider: provider() },
        crypto,
      );
      const parties = readPartySnapshot(snap, crypto)!;
      expect(parties.customer).toEqual({
        fullName: 'Khách A',
        dateOfBirth: '15/05/1992',
        placeOfOrigin: 'Quận 1, TP.HCM',
        address: '25 Lê Lợi',
        phone: '0911222333',
      });
      expect(parties.provider).toEqual({
        fullName: 'Chủ vườn B',
        dateOfBirth: '20/10/1985',
        placeOfOrigin: 'TP. Bảo Lộc, Lâm Đồng',
        address: '12 Nguyễn Văn Bảo',
        phone: '0909123456',
      });
      expect(JSON.stringify(parties)).not.toContain('Enc');
    });

    it('v2 cũ có identityNumberEnc/identityDocuments → loại bỏ số CCCD & ảnh, vẫn giải mã SĐT', () => {
      const legacyV2 = {
        version: 2,
        customer: {
          fullName: 'Khách Cũ',
          address: '123 ABC',
          phoneEnc: crypto.encrypt('0911222333'),
          identityNumberEnc: crypto.encrypt('001111111111'),
          identityDocuments: ['https://x/c-front.jpg'],
        },
        provider: {
          fullName: 'Vườn Cũ',
          address: '456 DEF',
          phoneEnc: crypto.encrypt('0909123456'),
          identityNumberEnc: crypto.encrypt('002222222222'),
          identityDocuments: ['https://x/p-front.jpg'],
        },
      };
      const parties = readPartySnapshot(legacyV2, crypto)!;
      expect(parties.customer).toEqual({
        fullName: 'Khách Cũ',
        dateOfBirth: 'Chưa cung cấp',
        placeOfOrigin: 'Chưa cung cấp',
        address: '123 ABC',
        phone: '0911222333',
      });
      const json = JSON.stringify(parties);
      expect(json).not.toContain('001111111111');
      expect(json).not.toContain('c-front.jpg');
      expect(json).not.toContain('identityNumber');
      expect(json).not.toContain('identityDocuments');
    });

    it('v3 thiếu SĐT/ngày sinh/quê quán → "Chưa cung cấp"', () => {
      const snap = buildPartySnapshot(
        { customer: null, provider: null },
        crypto,
      );
      expect(readPartySnapshot(snap, crypto)!.provider).toEqual({
        fullName: 'Chưa cung cấp',
        dateOfBirth: 'Chưa cung cấp',
        placeOfOrigin: 'Chưa cung cấp',
        address: 'Chưa cung cấp',
        phone: 'Chưa cung cấp',
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
    it('đủ SĐT + Địa chỉ + Ngày sinh + Quê quán → qua', () => {
      expect(() => assertProviderIdentityComplete(provider())).not.toThrow();
    });

    it.each([
      ['thiếu Ngày sinh', { dateOfBirth: null }],
      ['thiếu Quê quán', { placeOfOrigin: null }],
      ['thiếu Địa chỉ', { address: null }],
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
