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

export interface OrderSettlementInput {
  // Giá gói khách ĐÃ TRẢ (amount dòng PACKAGE_PRICE = giá gói × số cây lúc ký).
  packagePaid: bigint;
  // Phí 6% đã thu thật trên dòng gói.
  packageFeeCollected: bigint;
  // Giá công chốt lúc nhận cây = giá gói × số cây vườn nhận (≤ packagePaid).
  finalTotal: bigint;
  // Các dòng add-on khách đã trả (giá + phí 6% đã thu của từng dòng).
  addons: AddonLine[];
  pickupFee: bigint;
  // R — tiền công hoàn cho khách khi vườn có lỗi (thoả thuận hoặc admin phân xử). Đơn thường = 0.
  refund?: bigint;
  // C — tiền đền giá trị cây, lấy từ sổ bảo đảm. Đơn thường = 0.
  compensation?: bigint;
  // Số dư sổ bảo đảm của đơn (tiền vườn nộp lúc nhận cây). Chưa có tiền bảo đảm = 0.
  securityBalance?: bigint;
}

export interface OrderSettlement {
  // Tổng tiền đơn khách đã trả = gói + phí 6% gói + phí lấy cây + Σ (add-on + phí 6% add-on).
  totalPaid: bigint;
  // D — phần chênh do cây bị từ chối lúc nhận = packagePaid − finalTotal.
  rejectedAmount: bigint;
  // S — tiền công đang giữ = finalTotal + Σ add-on. Trần của R.
  serviceAmount: bigint;
  // Sổ đơn → khách: (D + R) + phần 6% tương ứng.
  customerFeeRefund: bigint;
  customerRefund: bigint;
  // Phí 12% vườn bị trừ; tách theo dòng hoá đơn để ghi lại vào payment_components.
  providerFee: bigint;
  packageProviderFee: bigint;
  addonProviderFees: bigint[];
  // Sổ đơn → vườn và → nền tảng.
  providerReceives: bigint;
  platformFee: bigint;
  // Sổ bảo đảm → khách (C) và → vườn (phần còn lại).
  compensation: bigint;
  securityReturn: bigint;
}

/**
 * Chia tiền TỔNG QUÁT cho cả hai sổ của đơn — đơn hoàn tất bình thường là trường hợp R = 0, C = 0.
 *   D = packagePaid − finalTotal (cây bị từ chối lúc nhận) · S = finalTotal + Σ add-on
 *   khách (sổ đơn) = (D + R) + 6% × (D + R), phần 6% không vượt tổng phí 6% đã thu
 *   vườn  (sổ đơn) = (S − R) − 12% × (S − R) + phí lấy cây
 *   nền tảng       = PHẦN CÒN LẠI của tiền đơn → làm tròn kiểu gì sổ đơn cũng về 0
 *   sổ bảo đảm     = khách nhận C, vườn nhận phần còn lại
 * Phí 12%: R = 0 thì tính theo TỪNG dòng hoá đơn (gói, từng add-on) đúng như `computeSettlement` +
 * `computeAddonSettlement` — đơn bình thường không lệch đồng nào so với trước. R > 0 thì tiền công
 * còn giữ không còn gắn với dòng nào → tính một lần trên tổng (S − R), ghi vào dòng gói.
 *
 * Đơn mẫu 2 cây × 200.000, phí lấy cây 60.000 (khách trả 484.000), bảo đảm 3.400.000:
 *   bình thường            → khách 0       · vườn 412.000 · nền tảng 72.000 · bảo đảm về vườn 3.400.000
 *   1 cây bị từ chối       → khách 212.000 · vườn 236.000 · nền tảng 36.000
 *   R = 200.000, C = 3tr   → khách 212.000 · vườn 236.000 · nền tảng 36.000 · đền 3.000.000, về vườn 400.000
 *   R = 400.000 (hoàn hết) → khách 424.000 · vườn 60.000  · nền tảng 0
 * Ném RangeError khi số âm, finalTotal > packagePaid, R > S hoặc C > số dư sổ bảo đảm — nhờ vậy
 * không sổ nào âm.
 */
export function computeDisputeSettlement(
  input: OrderSettlementInput,
): OrderSettlement {
  const { packagePaid, packageFeeCollected, finalTotal, addons, pickupFee } =
    input;
  const refund = input.refund ?? 0n;
  const compensation = input.compensation ?? 0n;
  const securityBalance = input.securityBalance ?? 0n;
  const amounts = [
    packagePaid,
    packageFeeCollected,
    finalTotal,
    pickupFee,
    refund,
    compensation,
    securityBalance,
  ];
  if (amounts.some((amount) => amount < 0n)) {
    throw new RangeError('computeDisputeSettlement chỉ nhận số không âm');
  }
  if (finalTotal > packagePaid) {
    throw new RangeError('finalTotal không được vượt giá gói khách đã trả');
  }
  // Kiểm số âm từng dòng add-on + lấy phí 12% theo dòng (dùng khi R = 0).
  const addonPart = computeAddonSettlement(addons);
  const addonFeeCollected = addons.reduce(
    (sum, line) => sum + line.customerFee,
    0n,
  );
  const serviceAmount = finalTotal + addonPart.addonAmount;
  if (refund > serviceAmount) {
    throw new RangeError('Tiền công hoàn (R) không được vượt tiền công (S)');
  }
  if (compensation > securityBalance) {
    throw new RangeError('Tiền đền (C) không được vượt số dư sổ bảo đảm');
  }

  const totalPaid =
    packagePaid +
    packageFeeCollected +
    pickupFee +
    addonPart.addonAmount +
    addonFeeCollected;

  // Khách: phần chênh cây bị từ chối + tiền công hoàn, kèm 6% của đúng phần đó (nền tảng không thu
  // phí trên dịch vụ không được làm). Chặn trần bằng phí đã thu: làm tròn lẻ không thể hoàn quá.
  const rejectedAmount = packagePaid - finalTotal;
  const refundBase = rejectedAmount + refund;
  const feeCollected = packageFeeCollected + addonFeeCollected;
  const feeOnRefund = halfUpPercent(refundBase, CUSTOMER_FEE_PERCENT);
  const customerFeeRefund =
    feeOnRefund > feeCollected ? feeCollected : feeOnRefund;
  const customerRefund = refundBase + customerFeeRefund;

  // Vườn: 12% trên tiền công còn giữ.
  const keptAmount = serviceAmount - refund;
  let packageProviderFee: bigint;
  let addonProviderFees: bigint[];
  if (refund === 0n) {
    packageProviderFee = halfUpPercent(finalTotal, PROVIDER_FEE_PERCENT);
    addonProviderFees = addonPart.providerFees;
  } else {
    packageProviderFee = halfUpPercent(keptAmount, PROVIDER_FEE_PERCENT);
    addonProviderFees = addons.map(() => 0n);
  }
  const providerFee = addonProviderFees.reduce(
    (sum, fee) => sum + fee,
    packageProviderFee,
  );
  const providerReceives = keptAmount - providerFee + pickupFee;

  return {
    totalPaid,
    rejectedAmount,
    serviceAmount,
    customerFeeRefund,
    customerRefund,
    providerFee,
    packageProviderFee,
    addonProviderFees,
    providerReceives,
    // = (phí 6% đã thu − phí 6% hoàn) + phí 12% ≥ 0.
    platformFee: totalPaid - customerRefund - providerReceives,
    compensation,
    securityReturn: securityBalance - compensation,
  };
}

export interface HandoverCancelInput {
  // Ai làm đơn huỷ lúc nhận cây: khách không giao cây, hay vườn không nộp tiền bảo đảm.
  cancelledBy: 'CUSTOMER' | 'PROVIDER';
  // Giá gói khách đã trả (dòng PACKAGE_PRICE) và phí 6% đã thu thật trên dòng đó.
  packagePaid: bigint;
  packageFeeCollected: bigint;
  pickupFee: bigint;
  // Số dư sổ đơn lúc huỷ (≥ tổng 3 khoản trên; lớn hơn khi khách chuyển dư).
  orderBalance: bigint;
}

export interface HandoverCancelSettlement {
  // Sổ đơn → khách (bút toán REFUND + lệnh chi REFUND).
  customerRefund: bigint;
  // Sổ đơn → vườn (bút toán PAYOUT + lệnh chi PAYOUT).
  providerReceives: bigint;
  // Hai nhánh huỷ tại chỗ nền tảng không thu đồng nào.
  platformFee: bigint;
}

/**
 * Chia sổ đơn khi đơn huỷ TẠI CHỖ lúc nhận cây (chưa có kỳ chăm, chưa có add-on, chưa có tiền bảo đảm).
 *   Khách không giao cây: vườn đã mất công tới nơi nên giữ phí lấy cây; khách nhận lại giá gói + 6% đã thu.
 *   Vườn không nộp tiền bảo đảm: lỗi của vườn → khách nhận lại TOÀN BỘ số dư sổ đơn, kể cả phí lấy cây.
 * Đơn mẫu 2 cây × 200.000, phí 6% = 24.000, phí lấy cây 60.000 (sổ đơn 484.000):
 *   khách không giao cây → khách 424.000 · vườn 60.000 · nền tảng 0
 *   vườn không nộp       → khách 484.000 · vườn 0      · nền tảng 0
 * Ném RangeError khi số âm hoặc sổ không đủ tiền để chia.
 */
export function computeHandoverCancelSettlement(
  input: HandoverCancelInput,
): HandoverCancelSettlement {
  const { packagePaid, packageFeeCollected, pickupFee, orderBalance } = input;
  if (
    [packagePaid, packageFeeCollected, pickupFee, orderBalance].some(
      (amount) => amount < 0n,
    )
  ) {
    throw new RangeError(
      'computeHandoverCancelSettlement chỉ nhận số không âm',
    );
  }
  if (orderBalance < packagePaid + packageFeeCollected + pickupFee) {
    throw new RangeError('Số dư sổ đơn không đủ để hoàn');
  }
  if (input.cancelledBy === 'PROVIDER') {
    return {
      customerRefund: orderBalance,
      providerReceives: 0n,
      platformFee: 0n,
    };
  }
  return {
    customerRefund: packagePaid + packageFeeCollected,
    providerReceives: pickupFee,
    platformFee: 0n,
  };
}
