import { CUSTOMER_FEE_PERCENT, halfUpPercent } from '../payments/settlement';

/**
 * Luật tranh chấp — toán thuần (không chạm DB) để unit-test được mọi nhánh.
 * Đơn mẫu dùng xuyên suốt: 2 cây × 200.000 (giá gói), phí lấy cây 60.000; cây A khách khai 3.000.000,
 * cây B không khai (mức đền 2 × 200.000 = 400.000) → tiền bảo đảm 3.400.000.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// Hai bên có 3 ngày tự thoả thuận kể từ lúc khách mở tranh chấp (không phải 5 ngày: kết quả mặc định
// có lợi cho một bên nên hạn dài chỉ làm chậm tiền).
export const NEGOTIATION_DAYS = 3;
// Hạn MỀM cho admin: quá 5 ngày chỉ nổi lên đầu danh sách kèm nhãn trễ, hệ thống không tự xử.
export const ADMIN_REVIEW_SOFT_DAYS = 5;

export const DISPUTE_STATUSES = [
  'NEGOTIATING',
  'ADMIN_REVIEW',
  'RESOLVED',
] as const;
export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

// Cách tranh chấp kết thúc: hai bên đồng ý một đề nghị / khách rút / admin phân xử.
export const DISPUTE_OUTCOMES = ['AGREED', 'WITHDRAWN', 'ADJUDICATED'] as const;
export type DisputeOutcome = (typeof DISPUTE_OUTCOMES)[number];

// Kết luận của admin cho TỪNG cây bị khiếu nại:
// NOT_AT_FAULT vườn không lỗi · SERVICE_FAULT vườn lỗi, chỉ hoàn tiền công cây đó ·
// VALUE_LOST vườn lỗi và cây mất giá trị: hoàn tiền công + đền trọn mức đền.
export const DISPUTE_VERDICTS = [
  'NOT_AT_FAULT',
  'SERVICE_FAULT',
  'VALUE_LOST',
] as const;
export type DisputeVerdict = (typeof DISPUTE_VERDICTS)[number];

export const DISPUTE_PARTIES = ['CUSTOMER', 'PROVIDER'] as const;
export type DisputeParty = (typeof DISPUTE_PARTIES)[number];

export const DISPUTE_OFFER_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'SUPERSEDED',
] as const;
export type DisputeOfferStatus = (typeof DISPUTE_OFFER_STATUSES)[number];

// Không có đường tắt NEGOTIATING → ADMIN_REVIEW do người bấm: chỉ bộ quét chuyển khi hết 3 ngày.
export const DISPUTE_TRANSITIONS: Record<
  DisputeStatus,
  readonly DisputeStatus[]
> = {
  NEGOTIATING: ['RESOLVED', 'ADMIN_REVIEW'],
  ADMIN_REVIEW: ['RESOLVED'],
  RESOLVED: [],
};

export function canTransitionDispute(
  from: DisputeStatus,
  to: DisputeStatus,
): boolean {
  return DISPUTE_TRANSITIONS[from].includes(to);
}

// Mở 15/11 16:00 → hạn thương lượng 18/11 16:00.
export function negotiationDueAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + NEGOTIATION_DAYS * DAY_MS);
}

// Chuyển admin 18/11 16:05 → ngày dự kiến có kết quả 23/11 16:05.
export function adminDueAt(escalatedAt: Date): Date {
  return new Date(escalatedAt.getTime() + ADMIN_REVIEW_SOFT_DAYS * DAY_MS);
}

export interface DisputeCapsInput {
  // Giá công chốt lúc nhận cây = giá gói × số cây vườn nhận.
  finalTotal: bigint;
  // Giá các add-on khách ĐÃ TRẢ (chưa gồm 6%).
  paidAddonAmounts: bigint[];
  // Mức đền (protection_cap) của từng cây BỊ KHIẾU NẠI.
  disputedProtectionCaps: bigint[];
  // Số dư sổ bảo đảm của đơn (tiền vườn đã nộp lúc nhận cây; đơn cũ trước khi có tiền bảo đảm → 0).
  securityBalance: bigint;
}

export interface DisputeCaps {
  // Trần tiền công hoàn (R).
  refundCap: bigint;
  // Trần tiền đền (C).
  compensationCap: bigint;
}

/**
 * Hai trần của một đề nghị thương lượng.
 *   hoàn công ≤ tiền công đang giữ = final_total + Σ add-on đã trả
 *   đền       ≤ min(Σ mức đền của các cây bị khiếu nại, số dư sổ bảo đảm)
 * Đơn mẫu: hoàn công ≤ 400.000 (có add-on 100.000 đã trả thì ≤ 500.000);
 * đền ≤ 3.000.000 khi chỉ khiếu nại cây A, ≤ 3.400.000 khi khiếu nại cả hai.
 * Đơn cũ không có tiền bảo đảm (sổ bảo đảm 0) → đền ≤ 0, chỉ thoả thuận được tiền công.
 */
export function computeDisputeCaps(input: DisputeCapsInput): DisputeCaps {
  const amounts = [
    input.finalTotal,
    ...input.paidAddonAmounts,
    ...input.disputedProtectionCaps,
    input.securityBalance,
  ];
  if (amounts.some((amount) => amount < 0n)) {
    throw new RangeError('computeDisputeCaps chỉ nhận số không âm');
  }
  const sum = (values: bigint[]) =>
    values.reduce((total, value) => total + value, 0n);
  return {
    refundCap: input.finalTotal + sum(input.paidAddonAmounts),
    compensationCap: capCompensation(
      sum(input.disputedProtectionCaps),
      input.securityBalance,
    ),
  };
}

/**
 * Tiền đền chỉ lấy từ sổ bảo đảm của chính đơn đó nên không bao giờ vượt số dư sổ ấy — nền tảng không
 * bù phần thiếu. Đơn có bảo đảm đầy đủ thì số dư ≥ Σ mức đền nên kết quả không đổi
 * (đền 3.000.000, sổ 3.400.000 → 3.000.000). Đơn cũ không có tiền bảo đảm: đền 3.000.000, sổ 0 → 0.
 */
export function capCompensation(
  compensation: bigint,
  securityBalance: bigint,
): bigint {
  if (compensation < 0n || securityBalance < 0n) {
    throw new RangeError('capCompensation chỉ nhận số không âm');
  }
  return compensation < securityBalance ? compensation : securityBalance;
}

export type OfferCheck =
  | 'OK'
  // Số âm (DTO đã chặn chuỗi không phải số nguyên; đây là chốt thứ hai).
  | 'OFFER_INVALID'
  // Cả hai số cùng bằng 0 — muốn thôi thì khách rút khiếu nại.
  | 'OFFER_EMPTY'
  | 'OFFER_EXCEEDS_CAP';

/**
 * Kiểm một đề nghị: hai số nguyên đồng ≥ 0, không cùng bằng 0, không số nào vượt trần của nó.
 * Đơn mẫu khiếu nại cây A: (100.000 ; 1.000.000) OK · (400.001 ; 0) vượt trần công ·
 * (0 ; 3.000.001) vượt trần đền · (0 ; 0) rỗng.
 */
export function checkOffer(
  refund: bigint,
  compensation: bigint,
  caps: DisputeCaps,
): OfferCheck {
  if (refund < 0n || compensation < 0n) return 'OFFER_INVALID';
  if (refund === 0n && compensation === 0n) return 'OFFER_EMPTY';
  if (refund > caps.refundCap || compensation > caps.compensationCap) {
    return 'OFFER_EXCEEDS_CAP';
  }
  return 'OK';
}

export interface VerdictPlant {
  verdict: DisputeVerdict;
  // Mức đền của cây (plants.protection_cap).
  protectionCap: bigint;
}

export interface VerdictAmounts {
  // R — tiền công hoàn = Σ giá gói của các cây vườn có lỗi (SERVICE_FAULT hoặc VALUE_LOST).
  refund: bigint;
  // C — tiền đền = Σ mức đền của các cây VALUE_LOST.
  compensation: bigint;
  // Mọi cây bị khiếu nại đều không lỗi = khách khiếu nại sai → ghi một lần thua (không phạt tiền).
  allNotAtFault: boolean;
}

/**
 * Admin chỉ kết luận từng cây, hệ thống tự ra tiền. Add-on không vào phần admin xử.
 * Đơn mẫu, khiếu nại cây A: NOT_AT_FAULT → R 0, C 0 · SERVICE_FAULT → R 200.000, C 0 ·
 * VALUE_LOST → R 200.000, C 3.000.000. Cả hai cây VALUE_LOST → R 400.000, C 3.400.000.
 */
export function computeVerdictAmounts(
  plants: VerdictPlant[],
  basePrice: bigint,
): VerdictAmounts {
  if (basePrice < 0n || plants.some((plant) => plant.protectionCap < 0n)) {
    throw new RangeError('computeVerdictAmounts chỉ nhận số không âm');
  }
  let refund = 0n;
  let compensation = 0n;
  for (const plant of plants) {
    if (plant.verdict === 'NOT_AT_FAULT') continue;
    refund += basePrice;
    if (plant.verdict === 'VALUE_LOST') {
      compensation += plant.protectionCap;
    }
  }
  return {
    refund,
    compensation,
    allNotAtFault:
      plants.length > 0 &&
      plants.every((plant) => plant.verdict === 'NOT_AT_FAULT'),
  };
}

/**
 * Dòng "anh/chị nhận tổng cộng" app hiện cho khách = R + HALF_UP(6% × R) + C.
 * Tiền công hoàn lấy từ sổ đơn kèm 6% tương ứng (nền tảng không thu phí trên phần đó); tiền đền lấy từ
 * sổ bảo đảm, không dính phí. Ví dụ R 100.000, C 1.000.000 → 106.000 + 1.000.000 = 1.106.000.
 * (Chặn "6% hoàn không vượt phí đã thu" do hàm chia tiền lo — settlement.ts; với R ≤ trần thì chỉ lệch
 * tối đa vài đồng làm tròn.)
 */
export function customerReceives(refund: bigint, compensation: bigint): bigint {
  return refund + halfUpPercent(refund, CUSTOMER_FEE_PERCENT) + compensation;
}
