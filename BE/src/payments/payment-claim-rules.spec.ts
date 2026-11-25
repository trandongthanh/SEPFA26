import { ConflictException } from '@nestjs/common';
import {
  assertClaimUsableForTransaction,
  claimPartyOf,
  PAYMENT_CLAIM_MAX_OPEN,
  PAYMENT_CLAIM_MAX_PHOTOS,
} from './payment-claim-rules';

describe('payment-claim-rules', () => {
  it('giới hạn: 3 phiếu mở, 3 ảnh mỗi phiếu', () => {
    expect(PAYMENT_CLAIM_MAX_OPEN).toBe(3);
    expect(PAYMENT_CLAIM_MAX_PHOTOS).toBe(3);
  });

  describe('claimPartyOf', () => {
    const order = {
      customerAccountId: 'acc-lan',
      providerAccountId: 'acc-vuon',
    };

    it('khách của đơn → CUSTOMER; vườn của đơn → PROVIDER', () => {
      expect(claimPartyOf({ accountId: 'acc-lan', ...order })).toBe('CUSTOMER');
      expect(claimPartyOf({ accountId: 'acc-vuon', ...order })).toBe(
        'PROVIDER',
      );
    });

    it('người ngoài đơn → null', () => {
      expect(claimPartyOf({ accountId: 'acc-khac', ...order })).toBeNull();
    });

    it('hồ sơ một bên không nạp được (null) → không khớp nhầm', () => {
      expect(
        claimPartyOf({
          accountId: 'acc-lan',
          customerAccountId: null,
          providerAccountId: null,
        }),
      ).toBeNull();
      expect(
        claimPartyOf({
          accountId: 'acc-vuon',
          customerAccountId: null,
          providerAccountId: 'acc-vuon',
        }),
      ).toBe('PROVIDER');
    });
  });

  describe('assertClaimUsableForTransaction', () => {
    const openCustomerClaim = {
      status: 'OPEN' as const,
      serviceOrderId: 'order-1',
      party: 'CUSTOMER' as const,
    };

    it('phiếu không còn OPEN → 409 PAYMENT_CLAIM_NOT_OPEN (kể cả tiền không gắn đơn)', () => {
      for (const status of ['RESOLVED', 'REJECTED'] as const) {
        expect(() =>
          assertClaimUsableForTransaction({
            claim: { ...openCustomerClaim, status },
            transaction: { serviceOrderId: null, unmatchedReason: 'NO_CODE' },
          }),
        ).toThrow(new ConflictException('PAYMENT_CLAIM_NOT_OPEN'));
      }
    });

    it('tiền không gắn đơn + phiếu OPEN (đơn nào, bên nào cũng được) → dùng được', () => {
      expect(() =>
        assertClaimUsableForTransaction({
          claim: openCustomerClaim,
          transaction: { serviceOrderId: null, unmatchedReason: 'NO_CODE' },
        }),
      ).not.toThrow();
      expect(() =>
        assertClaimUsableForTransaction({
          claim: { ...openCustomerClaim, party: 'PROVIDER' },
          transaction: { serviceOrderId: null, unmatchedReason: null },
        }),
      ).not.toThrow();
    });

    it('tiền đơn gắn đơn + phiếu khách cùng đơn → dùng được', () => {
      expect(() =>
        assertClaimUsableForTransaction({
          claim: openCustomerClaim,
          transaction: {
            serviceOrderId: 'order-1',
            unmatchedReason: 'INSUFFICIENT_AMOUNT',
          },
        }),
      ).not.toThrow();
    });

    it('tiền bảo đảm gắn đơn + phiếu vườn cùng đơn → dùng được', () => {
      expect(() =>
        assertClaimUsableForTransaction({
          claim: { ...openCustomerClaim, party: 'PROVIDER' },
          transaction: {
            serviceOrderId: 'order-1',
            unmatchedReason: 'DEPOSIT_EXPIRED',
          },
        }),
      ).not.toThrow();
    });

    it('tiền gắn đơn nhưng phiếu khác đơn → 409 PAYMENT_CLAIM_MISMATCH', () => {
      expect(() =>
        assertClaimUsableForTransaction({
          claim: openCustomerClaim,
          transaction: {
            serviceOrderId: 'order-2',
            unmatchedReason: 'INSUFFICIENT_AMOUNT',
          },
        }),
      ).toThrow(new ConflictException('PAYMENT_CLAIM_MISMATCH'));
    });

    it('tiền gắn đơn, cùng đơn nhưng sai bên → 409 PAYMENT_CLAIM_MISMATCH', () => {
      // Tiền bảo đảm là của vườn, phiếu lại của khách.
      expect(() =>
        assertClaimUsableForTransaction({
          claim: openCustomerClaim,
          transaction: {
            serviceOrderId: 'order-1',
            unmatchedReason: 'DEPOSIT_INSUFFICIENT',
          },
        }),
      ).toThrow(new ConflictException('PAYMENT_CLAIM_MISMATCH'));
      // Tiền add-on là của khách, phiếu lại của vườn.
      expect(() =>
        assertClaimUsableForTransaction({
          claim: { ...openCustomerClaim, party: 'PROVIDER' },
          transaction: {
            serviceOrderId: 'order-1',
            unmatchedReason: 'ADDON_NOT_PAYABLE',
          },
        }),
      ).toThrow(new ConflictException('PAYMENT_CLAIM_MISMATCH'));
    });

    it('tiền gắn đơn chưa có lý do (dữ liệu cũ) → coi là tiền khách', () => {
      expect(() =>
        assertClaimUsableForTransaction({
          claim: openCustomerClaim,
          transaction: { serviceOrderId: 'order-1', unmatchedReason: null },
        }),
      ).not.toThrow();
      expect(() =>
        assertClaimUsableForTransaction({
          claim: { ...openCustomerClaim, party: 'PROVIDER' },
          transaction: { serviceOrderId: 'order-1', unmatchedReason: null },
        }),
      ).toThrow(new ConflictException('PAYMENT_CLAIM_MISMATCH'));
    });
  });
});
