// Công thức tiền của đơn — MỘT chỗ duy nhất, hàm thuần, tính bằng bigint (đồng nguyên).
//
// S (serviceAmount) = giá dịch vụ đã làm = final_total ?? provisional_total.
// - Khách trả thêm 6% trên S (không tính trên phí lấy cây).
// - Vườn bị trừ 12% trên S; phí lấy cây đi thẳng cho vườn, không trừ phí.
// - Nền tảng giữ 6% + 12% = 18% của S.
// Ví dụ bản đồ (5 cây, S = 1.000.000, phí lấy cây 60.000):
//   khách trả 1.120.000 · vườn nhận 940.000 · nền tảng 180.000.

export const CUSTOMER_FEE_PERCENT = 6n;
export const PROVIDER_FEE_PERCENT = 12n;

// amount × percent / 100, làm tròn HALF_UP về đồng nguyên. Chỉ nhận số không âm.
export function halfUpPercent(amount: bigint, percent: bigint): bigint {
  if (amount < 0n || percent < 0n) {
    throw new RangeError('halfUpPercent chỉ nhận số không âm');
  }
  // (a × p × 2 + 100) / 200 = round_half_up(a × p / 100) với bigint chia nguyên.
  return (amount * percent * 2n + 100n) / 200n;
}

// Phí 6% khách trả thêm trên giá dịch vụ.
export function customerFeeFor(serviceAmount: bigint): bigint {
  return halfUpPercent(serviceAmount, CUSTOMER_FEE_PERCENT);
}

export interface SettlementInput {
  serviceAmount: bigint;
  pickupFee: bigint;
}

export interface Settlement {
  serviceAmount: bigint;
  pickupFee: bigint;
  customerFee: bigint;
  providerFee: bigint;
  platformFee: bigint;
  customerTotal: bigint;
  providerReceives: bigint;
}

// Chia tiền khi đơn COMPLETED.
export function computeSettlement({
  serviceAmount,
  pickupFee,
}: SettlementInput): Settlement {
  if (serviceAmount < 0n || pickupFee < 0n) {
    throw new RangeError('computeSettlement chỉ nhận số không âm');
  }
  const customerFee = customerFeeFor(serviceAmount);
  const providerFee = halfUpPercent(serviceAmount, PROVIDER_FEE_PERCENT);
  return {
    serviceAmount,
    pickupFee,
    customerFee,
    providerFee,
    platformFee: customerFee + providerFee,
    customerTotal: serviceAmount + customerFee + pickupFee,
    providerReceives: serviceAmount - providerFee + pickupFee,
  };
}
