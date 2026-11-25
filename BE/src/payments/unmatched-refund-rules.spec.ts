import { BadRequestException } from '@nestjs/common';
import {
  resolveRefundTarget,
  suggestedRecipientType,
} from './unmatched-refund-rules';

const customerBank = {
  bankName: 'MBBank',
  bankAccount: '0123456789',
  bankHolder: 'NGUYEN VAN A',
  bankBin: '970422',
};
const otherBank = {
  bankName: 'VCB',
  bankAccount: '999888777',
  bankHolder: 'TRAN THI B',
  bankBin: null,
};

describe('unmatched-refund-rules', () => {
  describe('suggestedRecipientType', () => {
    it('tiền bảo đảm → vườn; tiền đơn / add-on → khách; không đơn → null', () => {
      expect(suggestedRecipientType('DEPOSIT_EXPIRED', true)).toBe('PROVIDER');
      expect(suggestedRecipientType('INSUFFICIENT_AMOUNT', true)).toBe(
        'CUSTOMER',
      );
      expect(suggestedRecipientType('ADDON_NOT_PAYABLE', true)).toBe(
        'CUSTOMER',
      );
      expect(suggestedRecipientType('NO_CODE', false)).toBeNull();
      // Dữ liệu cũ chưa có lý do nhưng gắn đơn → coi là tiền khách.
      expect(suggestedRecipientType(null, true)).toBe('CUSTOMER');
    });
  });

  describe('resolveRefundTarget', () => {
    const suggested = {
      type: 'CUSTOMER' as const,
      id: 'cust-1',
      bank: customerBank,
    };

    it('dùng TK gợi ý, không sửa → gắn khách, không cần ghi chú', () => {
      expect(
        resolveRefundTarget({
          hasOrder: true,
          suggested,
          requestedBank: null,
          note: null,
        }),
      ).toEqual({
        bank: customerBank,
        customerId: 'cust-1',
        providerId: null,
        overridden: false,
      });
    });

    it('nhập lại đúng TK gợi ý → vẫn coi là không đổi', () => {
      const target = resolveRefundTarget({
        hasOrder: true,
        suggested,
        requestedBank: { ...customerBank },
        note: null,
      });
      expect(target.overridden).toBe(false);
      expect(target.customerId).toBe('cust-1');
    });

    it('đổi TK khác gợi ý → bắt buộc ghi chú, lệnh không gắn khách', () => {
      expect(() =>
        resolveRefundTarget({
          hasOrder: true,
          suggested,
          requestedBank: otherBank,
          note: null,
        }),
      ).toThrow(new BadRequestException('RESOLUTION_NOTE_REQUIRED'));
      expect(
        resolveRefundTarget({
          hasOrder: true,
          suggested,
          requestedBank: otherBank,
          note: 'Người nhà chuyển hộ, có ảnh sao kê',
        }),
      ).toEqual({
        bank: otherBank,
        customerId: null,
        providerId: null,
        overridden: true,
      });
    });

    it('không gắn đơn → phải nhập TK và ghi chú', () => {
      expect(() =>
        resolveRefundTarget({
          hasOrder: false,
          suggested: null,
          requestedBank: null,
          note: 'x',
        }),
      ).toThrow(new BadRequestException('REFUND_BANK_INFO_REQUIRED'));
      expect(() =>
        resolveRefundTarget({
          hasOrder: false,
          suggested: null,
          requestedBank: otherBank,
          note: null,
        }),
      ).toThrow(new BadRequestException('RESOLUTION_NOTE_REQUIRED'));
    });

    it('hồ sơ gợi ý chưa có TK và admin không nhập → 400', () => {
      expect(() =>
        resolveRefundTarget({
          hasOrder: true,
          suggested: { ...suggested, bank: null },
          requestedBank: null,
          note: null,
        }),
      ).toThrow(new BadRequestException('REFUND_BANK_INFO_REQUIRED'));
    });

    // Tiền không gắn đơn + phiếu báo đã chuyển tiền: service đưa người nộp phiếu vào `suggested`,
    // hasOrder vẫn false — luật không đổi, chỉ đầu vào khác.
    describe('tiền không gắn đơn, gợi ý = người nộp phiếu', () => {
      it('có TK hồ sơ, admin không nhập, có ghi chú → gắn người nộp, TK hồ sơ', () => {
        expect(
          resolveRefundTarget({
            hasOrder: false,
            suggested,
            requestedBank: null,
            note: 'Sao kê MB 10:15, 530.000đ, NGUYEN THI LAN',
          }),
        ).toEqual({
          bank: customerBank,
          customerId: 'cust-1',
          providerId: null,
          overridden: false,
        });
      });

      it('phiếu của vườn → gắn providerId', () => {
        const target = resolveRefundTarget({
          hasOrder: false,
          suggested: { type: 'PROVIDER', id: 'prov-1', bank: otherBank },
          requestedBank: null,
          note: 'Sao kê tiền bảo đảm của vườn',
        });
        expect(target).toMatchObject({
          bank: otherBank,
          customerId: null,
          providerId: 'prov-1',
        });
      });

      it('thiếu ghi chú → 400 RESOLUTION_NOTE_REQUIRED dù đã có phiếu', () => {
        expect(() =>
          resolveRefundTarget({
            hasOrder: false,
            suggested,
            requestedBank: null,
            note: null,
          }),
        ).toThrow(new BadRequestException('RESOLUTION_NOTE_REQUIRED'));
      });

      it('hồ sơ người nộp chưa có TK, admin không nhập → 400 REFUND_BANK_INFO_REQUIRED', () => {
        expect(() =>
          resolveRefundTarget({
            hasOrder: false,
            suggested: { ...suggested, bank: null },
            requestedBank: null,
            note: 'Có ảnh sao kê',
          }),
        ).toThrow(new BadRequestException('REFUND_BANK_INFO_REQUIRED'));
      });

      it('hồ sơ chưa có TK, admin nhập TK + ghi chú → overridden, lệnh không gắn người nhận', () => {
        expect(
          resolveRefundTarget({
            hasOrder: false,
            suggested: { ...suggested, bank: null },
            requestedBank: otherBank,
            note: 'Khách gửi TK qua hotline, có ảnh sao kê',
          }),
        ).toEqual({
          bank: otherBank,
          customerId: null,
          providerId: null,
          overridden: true,
        });
      });

      it('admin nhập TK khác TK hồ sơ → overridden, lệnh không gắn người nhận', () => {
        expect(
          resolveRefundTarget({
            hasOrder: false,
            suggested,
            requestedBank: otherBank,
            note: 'Người nhà chuyển hộ, trả về TK người nhà',
          }),
        ).toEqual({
          bank: otherBank,
          customerId: null,
          providerId: null,
          overridden: true,
        });
      });
    });

    it('gợi ý là vườn → gắn providerId', () => {
      const target = resolveRefundTarget({
        hasOrder: true,
        suggested: { type: 'PROVIDER', id: 'prov-1', bank: otherBank },
        requestedBank: null,
        note: null,
      });
      expect(target.providerId).toBe('prov-1');
      expect(target.customerId).toBeNull();
    });
  });
});
