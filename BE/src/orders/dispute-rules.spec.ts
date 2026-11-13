import {
  ADMIN_REVIEW_SOFT_DAYS,
  DISPUTE_STATUSES,
  DisputeStatus,
  NEGOTIATION_DAYS,
  adminDueAt,
  canTransitionDispute,
  capCompensation,
  checkOffer,
  computeDisputeCaps,
  computeVerdictAmounts,
  customerReceives,
  negotiationDueAt,
} from './dispute-rules';

// Đơn mẫu: 2 cây × 200.000; cây A khai 3.000.000, cây B không khai → mức đền 400.000.
const BASE_PRICE = 200_000n;
const CAP_A = 3_000_000n;
const CAP_B = 400_000n;

describe('dispute-rules', () => {
  describe('hạn', () => {
    it('thương lượng 3 ngày, hạn mềm admin 5 ngày', () => {
      expect(NEGOTIATION_DAYS).toBe(3);
      expect(ADMIN_REVIEW_SOFT_DAYS).toBe(5);
      const opened = new Date('2026-11-15T09:00:00.000Z');
      expect(negotiationDueAt(opened).toISOString()).toBe(
        '2026-11-18T09:00:00.000Z',
      );
      expect(adminDueAt(opened).toISOString()).toBe('2026-11-20T09:00:00.000Z');
    });
  });

  describe('bảng chuyển trạng thái', () => {
    const ALLOWED: [DisputeStatus, DisputeStatus][] = [
      ['NEGOTIATING', 'RESOLVED'],
      ['NEGOTIATING', 'ADMIN_REVIEW'],
      ['ADMIN_REVIEW', 'RESOLVED'],
    ];

    it.each(ALLOWED)('cho phép %s → %s', (from, to) => {
      expect(canTransitionDispute(from, to)).toBe(true);
    });

    it('mọi cặp ngoài bảng đều bị cấm (RESOLVED là trạng thái cuối, admin không trả về thương lượng)', () => {
      const allowed = new Set(ALLOWED.map(([from, to]) => `${from}>${to}`));
      for (const from of DISPUTE_STATUSES) {
        for (const to of DISPUTE_STATUSES) {
          if (allowed.has(`${from}>${to}`)) continue;
          expect(canTransitionDispute(from, to)).toBe(false);
        }
      }
    });
  });

  describe('computeDisputeCaps', () => {
    it('chỉ khiếu nại cây A, không add-on → công ≤ 400.000, đền ≤ 3.000.000', () => {
      expect(
        computeDisputeCaps({
          finalTotal: 400_000n,
          paidAddonAmounts: [],
          disputedProtectionCaps: [CAP_A],
          securityBalance: 3_400_000n,
        }),
      ).toEqual({ refundCap: 400_000n, compensationCap: 3_000_000n });
    });

    it('khiếu nại cả hai, có add-on 100.000 đã trả → công ≤ 500.000, đền ≤ 3.400.000', () => {
      expect(
        computeDisputeCaps({
          finalTotal: 400_000n,
          paidAddonAmounts: [100_000n],
          disputedProtectionCaps: [CAP_A, CAP_B],
          securityBalance: 3_400_000n,
        }),
      ).toEqual({ refundCap: 500_000n, compensationCap: 3_400_000n });
    });

    it('1 cây bị từ chối lúc nhận (final_total 200.000), khiếu nại cây B → 200.000 / 400.000', () => {
      expect(
        computeDisputeCaps({
          finalTotal: 200_000n,
          paidAddonAmounts: [],
          disputedProtectionCaps: [CAP_B],
          securityBalance: 3_400_000n,
        }),
      ).toEqual({ refundCap: 200_000n, compensationCap: 400_000n });
    });

    it('số âm → RangeError', () => {
      expect(() =>
        computeDisputeCaps({
          finalTotal: -1n,
          paidAddonAmounts: [],
          disputedProtectionCaps: [],
          securityBalance: 3_400_000n,
        }),
      ).toThrow(RangeError);
      expect(() =>
        computeDisputeCaps({
          finalTotal: 0n,
          paidAddonAmounts: [-1n],
          disputedProtectionCaps: [],
          securityBalance: 3_400_000n,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('trần đền không vượt số dư sổ bảo đảm', () => {
    it('đơn cũ không có tiền bảo đảm (sổ 0) → đền ≤ 0, trần công giữ nguyên', () => {
      const caps = computeDisputeCaps({
        finalTotal: 400_000n,
        paidAddonAmounts: [],
        disputedProtectionCaps: [CAP_A],
        securityBalance: 0n,
      });
      expect(caps).toEqual({ refundCap: 400_000n, compensationCap: 0n });
      // Đề nghị có tiền đền bị chặn ngay từ lúc gửi; đề nghị chỉ hoàn công vẫn gửi được.
      expect(checkOffer(0n, 1n, caps)).toBe('OFFER_EXCEEDS_CAP');
      expect(checkOffer(100_000n, 0n, caps)).toBe('OK');
    });

    it('sổ bảo đảm ít hơn Σ mức đền (dữ liệu lệch) → lấy số dư sổ', () => {
      expect(
        computeDisputeCaps({
          finalTotal: 400_000n,
          paidAddonAmounts: [],
          disputedProtectionCaps: [CAP_A, CAP_B],
          securityBalance: 1_000_000n,
        }).compensationCap,
      ).toBe(1_000_000n);
    });

    it('capCompensation: đủ bảo đảm thì không đổi, thiếu thì lấy số dư, số âm → RangeError', () => {
      expect(capCompensation(3_000_000n, 3_400_000n)).toBe(3_000_000n);
      expect(capCompensation(3_400_000n, 3_400_000n)).toBe(3_400_000n);
      expect(capCompensation(3_000_000n, 0n)).toBe(0n);
      expect(capCompensation(0n, 0n)).toBe(0n);
      expect(() => capCompensation(-1n, 0n)).toThrow(RangeError);
      expect(() => capCompensation(0n, -1n)).toThrow(RangeError);
    });

    it('số dư sổ bảo đảm âm → RangeError', () => {
      expect(() =>
        computeDisputeCaps({
          finalTotal: 0n,
          paidAddonAmounts: [],
          disputedProtectionCaps: [],
          securityBalance: -1n,
        }),
      ).toThrow(RangeError);
    });
  });

  describe('checkOffer', () => {
    const caps = { refundCap: 400_000n, compensationCap: 3_000_000n };

    it.each([
      [100_000n, 1_000_000n, 'OK'],
      // Đúng bằng trần vẫn hợp lệ.
      [400_000n, 3_000_000n, 'OK'],
      // Chỉ một trong hai số cũng được.
      [0n, 1n, 'OK'],
      [1n, 0n, 'OK'],
      [0n, 0n, 'OFFER_EMPTY'],
      [400_001n, 0n, 'OFFER_EXCEEDS_CAP'],
      [0n, 3_000_001n, 'OFFER_EXCEEDS_CAP'],
      [-1n, 5n, 'OFFER_INVALID'],
      [5n, -1n, 'OFFER_INVALID'],
    ] as const)('hoàn công %s, đền %s → %s', (refund, compensation, result) => {
      expect(checkOffer(refund, compensation, caps)).toBe(result);
    });
  });

  describe('computeVerdictAmounts', () => {
    it.each([
      ['NOT_AT_FAULT', 0n, 0n, true],
      ['SERVICE_FAULT', 200_000n, 0n, false],
      ['VALUE_LOST', 200_000n, 3_000_000n, false],
    ] as const)(
      'cây A %s → R %s, C %s',
      (verdict, refund, compensation, allNotAtFault) => {
        expect(
          computeVerdictAmounts(
            [{ verdict, protectionCap: CAP_A }],
            BASE_PRICE,
          ),
        ).toEqual({ refund, compensation, allNotAtFault });
      },
    );

    it('cây B không khai giá, mất giá trị → R 200.000, C 400.000', () => {
      expect(
        computeVerdictAmounts(
          [{ verdict: 'VALUE_LOST', protectionCap: CAP_B }],
          BASE_PRICE,
        ),
      ).toEqual({
        refund: 200_000n,
        compensation: 400_000n,
        allNotAtFault: false,
      });
    });

    it('cả hai cây mất giá trị → R 400.000, C 3.400.000', () => {
      expect(
        computeVerdictAmounts(
          [
            { verdict: 'VALUE_LOST', protectionCap: CAP_A },
            { verdict: 'VALUE_LOST', protectionCap: CAP_B },
          ],
          BASE_PRICE,
        ),
      ).toEqual({
        refund: 400_000n,
        compensation: 3_400_000n,
        allNotAtFault: false,
      });
    });

    it('A không lỗi, B lỗi dịch vụ → R 200.000, C 0, KHÔNG tính khách thua', () => {
      expect(
        computeVerdictAmounts(
          [
            { verdict: 'NOT_AT_FAULT', protectionCap: CAP_A },
            { verdict: 'SERVICE_FAULT', protectionCap: CAP_B },
          ],
          BASE_PRICE,
        ),
      ).toEqual({ refund: 200_000n, compensation: 0n, allNotAtFault: false });
    });

    it('cả hai cây không lỗi → 0 / 0, khách thua', () => {
      expect(
        computeVerdictAmounts(
          [
            { verdict: 'NOT_AT_FAULT', protectionCap: CAP_A },
            { verdict: 'NOT_AT_FAULT', protectionCap: CAP_B },
          ],
          BASE_PRICE,
        ),
      ).toEqual({ refund: 0n, compensation: 0n, allNotAtFault: true });
    });

    it('không có cây nào → 0 / 0 và không tính là thua; số âm → RangeError', () => {
      expect(computeVerdictAmounts([], BASE_PRICE)).toEqual({
        refund: 0n,
        compensation: 0n,
        allNotAtFault: false,
      });
      expect(() => computeVerdictAmounts([], -1n)).toThrow(RangeError);
      expect(() =>
        computeVerdictAmounts(
          [{ verdict: 'VALUE_LOST', protectionCap: -1n }],
          BASE_PRICE,
        ),
      ).toThrow(RangeError);
    });
  });

  describe('customerReceives', () => {
    it.each([
      // Thoả thuận hoàn công 100.000 + đền 1.000.000.
      [100_000n, 1_000_000n, 1_106_000n],
      // Ba mức kết luận cây A.
      [0n, 0n, 0n],
      [200_000n, 0n, 212_000n],
      [200_000n, 3_000_000n, 3_212_000n],
      // Chỉ đền, không hoàn công → không có 6%.
      [0n, 400_000n, 400_000n],
      // Làm tròn HALF_UP: 6% của 8 = 0,48 → 0; 6% của 9 = 0,54 → 1.
      [8n, 0n, 8n],
      [9n, 0n, 10n],
    ])('R %s, C %s → %s', (refund, compensation, total) => {
      expect(customerReceives(refund, compensation)).toBe(total);
    });
  });
});
