import { ConflictException } from '@nestjs/common';
import {
  ADDON_STATUSES,
  ADDON_TRANSITIONS,
  AddonStatus,
  assertAddonTransition,
  extractAddonCode,
  generateAddonCode,
  overdueReason,
  paymentDueAt,
  respondDueAt,
} from './addon-rules';
import { extractOrderCode, generateOrderCode } from './order-code';

describe('addon-rules', () => {
  describe('bảng chuyển trạng thái', () => {
    const ALLOWED: [AddonStatus, AddonStatus][] = [
      ['PENDING', 'ACCEPTED'],
      ['PENDING', 'REJECTED'],
      ['PENDING', 'EXPIRED'],
      ['ACCEPTED', 'PAID'],
      ['ACCEPTED', 'EXPIRED'],
      ['PAID', 'DONE'],
    ];

    it.each(ALLOWED)('cho phép %s → %s', (from, to) => {
      expect(() => assertAddonTransition(from, to)).not.toThrow();
    });

    it('mọi cặp ngoài bảng đều bị cấm (409 ADDON_INVALID_STATE)', () => {
      const allowed = new Set(ALLOWED.map(([from, to]) => `${from}>${to}`));
      for (const from of ADDON_STATUSES) {
        for (const to of ADDON_STATUSES) {
          if (allowed.has(`${from}>${to}`)) continue;
          expect(() => assertAddonTransition(from, to)).toThrow(
            ConflictException,
          );
        }
      }
    });

    it('khai đủ 6 trạng thái; DONE / REJECTED / EXPIRED là trạng thái cuối', () => {
      expect(Object.keys(ADDON_TRANSITIONS).sort()).toEqual(
        [...ADDON_STATUSES].sort(),
      );
      expect(ADDON_TRANSITIONS.DONE).toHaveLength(0);
      expect(ADDON_TRANSITIONS.REJECTED).toHaveLength(0);
      expect(ADDON_TRANSITIONS.EXPIRED).toHaveLength(0);
    });
  });

  describe('hạn', () => {
    const created = new Date('2026-11-13T08:00:00.000Z');

    it('hạn trả lời = lúc tạo + 48 giờ; hạn trả tiền = lúc đồng ý + 24 giờ', () => {
      expect(respondDueAt(created).toISOString()).toBe(
        '2026-11-15T08:00:00.000Z',
      );
      expect(paymentDueAt(created).toISOString()).toBe(
        '2026-11-14T08:00:00.000Z',
      );
    });

    it('PENDING: đúng mốc hạn vẫn còn hạn, quá 1 mili giây thì NO_RESPONSE', () => {
      const due = respondDueAt(created);
      const proposal = {
        status: 'PENDING' as const,
        respondDueAt: due,
        paymentDueAt: null,
      };
      expect(overdueReason(proposal, due)).toBeNull();
      expect(overdueReason(proposal, new Date(due.getTime() + 1))).toBe(
        'NO_RESPONSE',
      );
    });

    it('ACCEPTED: quá hạn trả tiền thì NOT_PAID, không xét lại hạn trả lời', () => {
      const payDue = paymentDueAt(created);
      const proposal = {
        status: 'ACCEPTED' as const,
        // Hạn trả lời đã qua từ lâu nhưng khách đã đồng ý kịp → không còn ý nghĩa.
        respondDueAt: new Date('2026-11-01T00:00:00.000Z'),
        paymentDueAt: payDue,
      };
      expect(overdueReason(proposal, payDue)).toBeNull();
      expect(overdueReason(proposal, new Date(payDue.getTime() + 1))).toBe(
        'NOT_PAID',
      );
    });

    it.each(['PAID', 'DONE', 'REJECTED', 'EXPIRED'] as const)(
      '%s không bao giờ hết hạn',
      (status) => {
        const longAgo = new Date('2020-01-01T00:00:00.000Z');
        expect(
          overdueReason(
            { status, respondDueAt: longAgo, paymentDueAt: longAgo },
            new Date('2026-11-13T00:00:00.000Z'),
          ),
        ).toBeNull();
      },
    );
  });

  describe('mã add-on', () => {
    it('sinh mã ADDON + 8 hex hoa', () => {
      expect(generateAddonCode()).toMatch(/^ADDON[0-9A-F]{8}$/);
    });

    it('tìm được mã giữa nội dung chuyển khoản thật, kể cả chữ thường', () => {
      expect(extractAddonCode('MBVCB.123 addon1a2b3c4d CT tu 0123')).toBe(
        'ADDON1A2B3C4D',
      );
      expect(extractAddonCode('chuyen tien')).toBeNull();
    });

    it('mã add-on và mã đơn không bao giờ bị nhận nhầm sang nhau', () => {
      for (let i = 0; i < 200; i += 1) {
        const addonCode = generateAddonCode();
        const orderCode = generateOrderCode();
        expect(extractOrderCode(addonCode)).toBeNull();
        expect(extractAddonCode(orderCode)).toBeNull();
        // Nội dung có cả hai mã: mỗi hàm chỉ lấy đúng loại của mình.
        const both = `${orderCode} ${addonCode}`;
        expect(extractOrderCode(both)).toBe(orderCode);
        expect(extractAddonCode(both)).toBe(addonCode);
      }
    });
  });
});
