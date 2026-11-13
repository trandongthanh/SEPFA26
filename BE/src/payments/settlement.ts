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

// Một dòng hoá đơn add-on khách đã trả: giá add-on + phí 6% ĐÃ THU thật lúc khách chuyển khoản.
export interface AddonLine {
  amount: bigint;
  customerFee: bigint;
}

export interface AddonSettlement {
  // Tổng giá các add-on (chưa gồm phí).
  addonAmount: bigint;
  // Phí 12% vườn bị trừ, theo từng dòng (cùng thứ tự `lines`) để ghi lại vào hoá đơn.
  providerFees: bigint[];
  providerFee: bigint;
  platformFee: bigint;
  providerReceives: bigint;
}

/**
 * Phần add-on khi chia tiền lúc đơn COMPLETED — cộng thêm vào kết quả `computeSettlement` của gói.
 * Phí tính theo TỪNG dòng rồi mới cộng: 6% đã làm tròn riêng ở mỗi lần thu, nếu tính lại trên tổng
 * thì lệch 1 đồng so với tiền thật trong sổ (vd 2 add-on 8đ: thu 0 + 0, tính trên 16đ lại ra 1).
 * Ví dụ add-on 100.000: khách đã trả 106.000 · vườn nhận 88.000 · nền tảng 6.000 + 12.000 = 18.000.
 */
export function computeAddonSettlement(lines: AddonLine[]): AddonSettlement {
  const result: AddonSettlement = {
    addonAmount: 0n,
    providerFees: [],
    providerFee: 0n,
    platformFee: 0n,
    providerReceives: 0n,
  };
  for (const line of lines) {
    if (line.amount < 0n || line.customerFee < 0n) {
      throw new RangeError('computeAddonSettlement chỉ nhận số không âm');
    }
    const providerFee = halfUpPercent(line.amount, PROVIDER_FEE_PERCENT);
    result.addonAmount += line.amount;
    result.providerFees.push(providerFee);
    result.providerFee += providerFee;
    result.platformFee += line.customerFee + providerFee;
    result.providerReceives += line.amount - providerFee;
  }
  return result;
}
