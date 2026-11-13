import {
  computeAddonSettlement,
  computeDisputeSettlement,
  computeHandoverCancelSettlement,
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

  describe('computeDisputeSettlement', () => {
    // Đơn mẫu: 2 cây × 200.000, phí lấy cây 60.000 → khách trả 484.000.
    // Cây A khai giá 3.000.000, cây B không khai (mức đền 2 × 200.000) → bảo đảm 3.400.000.
    const sample = {
      packagePaid: 400_000n,
      packageFeeCollected: 24_000n,
      finalTotal: 400_000n,
      addons: [],
      pickupFee: 60_000n,
      securityBalance: 3_400_000n,
    };
    const addon100 = { amount: 100_000n, customerFee: 6_000n };

    // 8 dòng bảng "Mọi tình huống của đơn mẫu" (mục 8 bản thiết kế), đơn vị đồng:
    // [tên, đầu vào khác đơn mẫu, sổ đơn → khách / vườn / nền tảng, bảo đảm → khách / vườn]
    const k = 1_000n;
    it.each([
      [
        'hoàn tất bình thường, khách thua hoặc khách rút',
        {},
        [0n, 412n * k, 72n * k, 0n, 3_400n * k],
      ],
      [
        'cây B bị từ chối lúc nhận (bảo đảm chỉ 3.000.000)',
        { finalTotal: 200_000n, securityBalance: 3_000_000n },
        [212n * k, 236n * k, 36n * k, 0n, 3_000n * k],
      ],
      [
        'vườn lỗi cây A, mất giá trị',
        { refund: 200_000n, compensation: 3_000_000n },
        [212n * k, 236n * k, 36n * k, 3_000n * k, 400n * k],
      ],
      [
        'vườn lỗi cây B (không khai giá), mất giá trị',
        { refund: 200_000n, compensation: 400_000n },
        [212n * k, 236n * k, 36n * k, 400n * k, 3_000n * k],
      ],
      [
        'vườn lỗi cây A nhưng cây không mất giá trị',
        { refund: 200_000n },
        [212n * k, 236n * k, 36n * k, 0n, 3_400n * k],
      ],
      [
        'vườn lỗi cả hai cây, mất giá trị',
        { refund: 400_000n, compensation: 3_400_000n },
        [424n * k, 60n * k, 0n, 3_400n * k, 0n],
      ],
      [
        'hai bên thoả thuận hoàn công 100.000, đền 1.000.000',
        { refund: 100_000n, compensation: 1_000_000n },
        [106n * k, 324n * k, 54n * k, 1_000n * k, 2_400n * k],
      ],
      [
        'có add-on 100.000 (sổ đơn 590.000), vườn lỗi cây A mất giá trị',
        { addons: [addon100], refund: 200_000n, compensation: 3_000_000n },
        [212n * k, 324n * k, 54n * k, 3_000n * k, 400n * k],
      ],
    ])('%s', (_name, override, expected) => {
      const input = { ...sample, ...override };
      const s = computeDisputeSettlement(input);
      expect([
        s.customerRefund,
        s.providerReceives,
        s.platformFee,
        s.compensation,
        s.securityReturn,
      ]).toEqual(expected);
      // Hai sổ đều về 0: tiền ra = tiền vào.
      expect(s.customerRefund + s.providerReceives + s.platformFee).toBe(
        s.totalPaid,
      );
      expect(s.compensation + s.securityReturn).toBe(input.securityBalance);
    });

    it('đơn mẫu: tổng khách đã trả 484.000, có add-on thì 590.000', () => {
      expect(computeDisputeSettlement(sample).totalPaid).toBe(484_000n);
      expect(
        computeDisputeSettlement({ ...sample, addons: [addon100] }).totalPaid,
      ).toBe(590_000n);
    });

    it('R = 0, C = 0, không cây bị từ chối → trùng từng đồng với hàm cũ (phí 12% theo từng dòng add-on)', () => {
      // Giá lẻ để lộ khác biệt nếu tính 12% trên tổng: 8 + 8 → theo dòng 1 + 1 = 2, trên tổng 16 cũng 2;
      // 4 + 4 → theo dòng 0 + 0 = 0, trên tổng 8 lại ra 1.
      const cases = [
        { service: 400_000n, pickup: 60_000n, addons: [] as bigint[] },
        { service: 400_000n, pickup: 60_000n, addons: [100_000n] },
        { service: 333_333n, pickup: 15_000n, addons: [33_333n, 1_008n] },
        { service: 200_000n, pickup: 0n, addons: [4n, 4n, 8n, 8n] },
        { service: 0n, pickup: 60_000n, addons: [] as bigint[] },
      ];
      for (const { service, pickup, addons } of cases) {
        const lines = addons.map((amount) => ({
          amount,
          customerFee: customerFeeFor(amount),
        }));
        const oldPackage = computeSettlement({
          serviceAmount: service,
          pickupFee: pickup,
        });
        const oldAddons = computeAddonSettlement(lines);
        const s = computeDisputeSettlement({
          packagePaid: service,
          packageFeeCollected: customerFeeFor(service),
          finalTotal: service,
          addons: lines,
          pickupFee: pickup,
        });
        expect(s.customerRefund).toBe(0n);
        expect(s.platformFee).toBe(
          oldPackage.platformFee + oldAddons.platformFee,
        );
        expect(s.providerReceives).toBe(
          oldPackage.providerReceives + oldAddons.providerReceives,
        );
        expect(s.packageProviderFee).toBe(oldPackage.providerFee);
        expect(s.addonProviderFees).toEqual(oldAddons.providerFees);
        expect(s.compensation).toBe(0n);
        expect(s.securityReturn).toBe(0n);
      }
    });

    it('R > 0 → phí 12% tính một lần trên tổng (S − R), ghi vào dòng gói', () => {
      // S = 400.000 + 4 + 4 = 400.008, R = 200.000 → 12% × 200.008 = 24.000,96 → 24.001.
      const s = computeDisputeSettlement({
        ...sample,
        addons: [
          { amount: 4n, customerFee: 0n },
          { amount: 4n, customerFee: 0n },
        ],
        refund: 200_000n,
      });
      expect(s.providerFee).toBe(24_001n);
      expect(s.packageProviderFee).toBe(24_001n);
      expect(s.addonProviderFees).toEqual([0n, 0n]);
      expect(s.providerReceives).toBe(200_008n - 24_001n + 60_000n);
      expect(s.customerRefund + s.providerReceives + s.platformFee).toBe(
        s.totalPaid,
      );
    });

    it('làm tròn lẻ: nền tảng lấy phần còn lại nên sổ đơn vẫn về 0', () => {
      // 3 cây × 33.333 = 99.999, phí 6% đã thu 6.000 (5.999,94 làm tròn lên); 1 cây bị từ chối.
      // Khách: 33.333 + 6% (1.999,98 → 2.000) = 35.333. Vườn: 66.666 − 12% (7.999,92 → 8.000) = 58.666.
      const s = computeDisputeSettlement({
        packagePaid: 99_999n,
        packageFeeCollected: 6_000n,
        finalTotal: 66_666n,
        addons: [],
        pickupFee: 0n,
      });
      expect(s.customerRefund).toBe(35_333n);
      expect(s.providerReceives).toBe(58_666n);
      expect(s.platformFee).toBe(105_999n - 35_333n - 58_666n);
      expect(s.platformFee).toBe(12_000n);
    });

    it('phần 6% hoàn không vượt phí 6% đã thu', () => {
      // 25đ: phí đã thu 2 (1,5 làm tròn lên). Đơn ký trước khi có phí 6% thì phí đã thu = 0.
      const full = computeDisputeSettlement({
        packagePaid: 25n,
        packageFeeCollected: 2n,
        finalTotal: 25n,
        addons: [],
        pickupFee: 0n,
        refund: 25n,
      });
      expect(full.customerRefund).toBe(27n);
      expect(full.platformFee).toBe(0n);

      const noFee = computeDisputeSettlement({
        packagePaid: 400_000n,
        packageFeeCollected: 0n,
        finalTotal: 200_000n,
        addons: [],
        pickupFee: 60_000n,
      });
      expect(noFee.customerFeeRefund).toBe(0n);
      expect(noFee.customerRefund).toBe(200_000n);
      // Nền tảng chỉ còn 12% của vườn; không bao giờ âm.
      expect(noFee.platformFee).toBe(24_000n);
    });

    it('ném RangeError: R > S, C > số dư bảo đảm, số âm, finalTotal > giá gói đã trả', () => {
      const bad = [
        { refund: 400_001n },
        { addons: [addon100], refund: 500_001n },
        { compensation: 3_400_001n },
        { securityBalance: undefined, compensation: 1n },
        { refund: -1n },
        { compensation: -1n },
        { securityBalance: -1n },
        { pickupFee: -1n },
        { packageFeeCollected: -1n },
        { addons: [{ amount: -1n, customerFee: 0n }] },
        { finalTotal: 400_001n },
      ];
      for (const override of bad) {
        expect(() =>
          computeDisputeSettlement({ ...sample, ...override }),
        ).toThrow(RangeError);
      }
      // Đúng mốc trần thì hợp lệ.
      expect(() =>
        computeDisputeSettlement({
          ...sample,
          addons: [addon100],
          refund: 500_000n,
          compensation: 3_400_000n,
        }),
      ).not.toThrow();
    });
  });

  describe('computeHandoverCancelSettlement — đơn huỷ tại chỗ lúc nhận cây', () => {
    // Đơn mẫu 2 cây × 200.000, phí 6% = 24.000, phí lấy cây 60.000 → sổ đơn 484.000.
    const sample = {
      packagePaid: 400_000n,
      packageFeeCollected: 24_000n,
      pickupFee: 60_000n,
      orderBalance: 484_000n,
    };

    it('khách không giao cây → khách 424.000, vườn giữ phí lấy cây 60.000, nền tảng 0', () => {
      const s = computeHandoverCancelSettlement({
        ...sample,
        cancelledBy: 'CUSTOMER',
      });
      expect(s).toEqual({
        customerRefund: 424_000n,
        providerReceives: 60_000n,
        platformFee: 0n,
      });
      expect(s.customerRefund + s.providerReceives + s.platformFee).toBe(
        484_000n,
      );
    });

    it('vườn không nộp tiền bảo đảm → khách 484.000 (kể cả phí lấy cây), vườn 0, nền tảng 0', () => {
      expect(
        computeHandoverCancelSettlement({ ...sample, cancelledBy: 'PROVIDER' }),
      ).toEqual({
        customerRefund: 484_000n,
        providerReceives: 0n,
        platformFee: 0n,
      });
    });

    it('đơn không có phí lấy cây: khách không giao cây thì vườn không nhận gì', () => {
      expect(
        computeHandoverCancelSettlement({
          ...sample,
          pickupFee: 0n,
          orderBalance: 424_000n,
          cancelledBy: 'CUSTOMER',
        }),
      ).toEqual({
        customerRefund: 424_000n,
        providerReceives: 0n,
        platformFee: 0n,
      });
    });

    it('khách chuyển dư 1.000: vườn huỷ thì hoàn cả phần dư (sổ về 0)', () => {
      expect(
        computeHandoverCancelSettlement({
          ...sample,
          orderBalance: 485_000n,
          cancelledBy: 'PROVIDER',
        }).customerRefund,
      ).toBe(485_000n);
    });

    it('ném RangeError khi số âm hoặc sổ không đủ tiền', () => {
      for (const override of [
        { packagePaid: -1n },
        { packageFeeCollected: -1n },
        { pickupFee: -1n },
        { orderBalance: -1n },
        { orderBalance: 483_999n },
      ]) {
        for (const cancelledBy of ['CUSTOMER', 'PROVIDER'] as const) {
          expect(() =>
            computeHandoverCancelSettlement({
              ...sample,
              ...override,
              cancelledBy,
            }),
          ).toThrow(RangeError);
        }
      }
    });
  });
});
