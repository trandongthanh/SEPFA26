import {
  computeAddonSettlement,
  computeSettlement,
  customerFeeFor,
  halfUpPercent,
} from './settlement';

describe('settlement', () => {
  describe('halfUpPercent', () => {
    it('chia hết thì giữ nguyên', () => {
      expect(halfUpPercent(1_000_000n, 6n)).toBe(60_000n);
    });

    it('lẻ ≥ 0,5 đồng thì làm tròn lên', () => {
      // 333.333 × 6% = 19.999,98 → 20.000; × 12% = 39.999,96 → 40.000
      expect(halfUpPercent(333_333n, 6n)).toBe(20_000n);
      expect(halfUpPercent(333_333n, 12n)).toBe(40_000n);
      // 25 × 6% = 1,5 → 2 (đúng mốc 0,5 làm tròn lên)
      expect(halfUpPercent(25n, 6n)).toBe(2n);
    });

    it('lẻ < 0,5 đồng thì làm tròn xuống', () => {
      // 8 × 6% = 0,48 → 0
      expect(halfUpPercent(8n, 6n)).toBe(0n);
    });

    it('từ chối số âm', () => {
      expect(() => halfUpPercent(-1n, 6n)).toThrow(RangeError);
    });
  });

  it('customerFeeFor = 6% giá dịch vụ', () => {
    expect(customerFeeFor(400_000n)).toBe(24_000n);
  });

  it('ví dụ bản đồ 5 cây: khách 1.120.000 / vườn 940.000 / nền tảng 180.000', () => {
    expect(
      computeSettlement({ serviceAmount: 1_000_000n, pickupFee: 60_000n }),
    ).toEqual({
      serviceAmount: 1_000_000n,
      pickupFee: 60_000n,
      customerFee: 60_000n,
      providerFee: 120_000n,
      platformFee: 180_000n,
      customerTotal: 1_120_000n,
      providerReceives: 940_000n,
    });
  });

  it('ví dụ e2e 2 cây × 200.000: khách 484.000 / vườn 412.000 / nền tảng 72.000', () => {
    const s = computeSettlement({
      serviceAmount: 400_000n,
      pickupFee: 60_000n,
    });
    expect(s.customerTotal).toBe(484_000n);
    expect(s.providerReceives).toBe(412_000n);
    expect(s.platformFee).toBe(72_000n);
    // Sổ về 0: khách trả = vườn nhận + nền tảng giữ
    expect(s.providerReceives + s.platformFee).toBe(s.customerTotal);
  });

  it('không có phí lấy cây', () => {
    const s = computeSettlement({ serviceAmount: 400_000n, pickupFee: 0n });
    expect(s.customerTotal).toBe(424_000n);
    expect(s.providerReceives).toBe(352_000n);
  });

  it('giá dịch vụ 0 → mọi phí 0, vườn chỉ nhận phí lấy cây', () => {
    const s = computeSettlement({ serviceAmount: 0n, pickupFee: 60_000n });
    expect(s.platformFee).toBe(0n);
    expect(s.providerReceives).toBe(60_000n);
    expect(s.customerTotal).toBe(60_000n);
  });

  it('S lẻ: tổng vẫn khớp (khách trả = vườn nhận + nền tảng)', () => {
    const s = computeSettlement({
      serviceAmount: 333_333n,
      pickupFee: 15_000n,
    });
    expect(s.customerFee).toBe(20_000n);
    expect(s.providerFee).toBe(40_000n);
    expect(s.providerReceives + s.platformFee).toBe(s.customerTotal);
  });

  it('từ chối số âm', () => {
    expect(() =>
      computeSettlement({ serviceAmount: -1n, pickupFee: 0n }),
    ).toThrow(RangeError);
  });

  describe('computeAddonSettlement', () => {
    const line = (amount: bigint) => ({
      amount,
      customerFee: customerFeeFor(amount),
    });

    it('không có add-on → mọi số 0 (đơn thường không đổi)', () => {
      expect(computeAddonSettlement([])).toEqual({
        addonAmount: 0n,
        providerFees: [],
        providerFee: 0n,
        platformFee: 0n,
        providerReceives: 0n,
      });
    });

    it('add-on 100.000: khách đã trả 106.000, vườn nhận 88.000, nền tảng 18.000', () => {
      const a = computeAddonSettlement([line(100_000n)]);
      expect(a.addonAmount).toBe(100_000n);
      expect(a.providerFees).toEqual([12_000n]);
      expect(a.platformFee).toBe(18_000n);
      expect(a.providerReceives).toBe(88_000n);
    });

    it('nhiều add-on giá lẻ: tiền đã thu = vườn nhận + nền tảng, không lệch đồng nào', () => {
      const lines = [line(33_333n), line(1_008n), line(8n), line(8n)];
      const collected = lines.reduce(
        (sum, l) => sum + l.amount + l.customerFee,
        0n,
      );
      const a = computeAddonSettlement(lines);
      expect(a.providerReceives + a.platformFee).toBe(collected);
      // Tính lại 6% trên TỔNG sẽ ra số khác tiền thật đã thu → lý do phải cộng theo từng dòng.
      const feeOnTotal = customerFeeFor(a.addonAmount);
      const feeCollected = lines.reduce((sum, l) => sum + l.customerFee, 0n);
      expect(feeOnTotal).not.toBe(feeCollected);
    });

    it('từ chối số âm', () => {
      expect(() =>
        computeAddonSettlement([{ amount: -1n, customerFee: 0n }]),
      ).toThrow(RangeError);
    });
  });
});
