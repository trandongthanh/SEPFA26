import {
  computeShippingFee,
  haversineKm,
  pickTier,
  ROAD_FACTOR,
  ShippingTier,
} from './shipping-fee';

// Bộ bậc giá giống seed thật: 3 bậc nối liền mạch tại ranh giới.
const TIERS: ShippingTier[] = [
  { minKm: '0.00', maxKm: '5.00', baseFee: '20000', perKmFee: '0' },
  { minKm: '5.00', maxKm: '15.00', baseFee: '20000', perKmFee: '3000' },
  { minKm: '15.00', maxKm: null, baseFee: '50000', perKmFee: '2500' },
];

describe('pickTier', () => {
  it('0 km → bậc đầu', () => {
    expect(pickTier(TIERS, 0)).toBe(TIERS[0]);
  });

  it('4.99 km → bậc 1; đúng ranh 5 km → bậc 2 (nửa khoảng [min, max))', () => {
    expect(pickTier(TIERS, 4.99)).toBe(TIERS[0]);
    expect(pickTier(TIERS, 5)).toBe(TIERS[1]);
  });

  it('bậc cuối maxKm=null nhận mọi km lớn', () => {
    expect(pickTier(TIERS, 15)).toBe(TIERS[2]);
    expect(pickTier(TIERS, 999)).toBe(TIERS[2]);
  });

  it('danh sách rỗng / km âm → undefined (service sẽ báo lỗi cấu hình)', () => {
    expect(pickTier([], 3)).toBeUndefined();
    expect(pickTier(TIERS, -1)).toBeUndefined();
  });
});

describe('computeShippingFee', () => {
  it('trong bậc phẳng: 3 km → 20.000đ', () => {
    expect(computeShippingFee(TIERS[0], 3)).toBe(20000);
  });

  it('ví dụ chuẩn trong sơ đồ: 12 km → 20.000 + 7×3.000 = 41.000đ', () => {
    expect(computeShippingFee(TIERS[1], 12)).toBe(41000);
  });

  it('liền mạch tại ranh 15 km: bậc 2 và bậc 3 cho cùng 50.000đ (phí không giật cục)', () => {
    expect(computeShippingFee(TIERS[1], 15)).toBe(50000);
    expect(computeShippingFee(TIERS[2], 15)).toBe(50000);
  });

  it('làm tròn HALF_UP về đồng nguyên: 5.5005 km lẻ → số nguyên', () => {
    const fee = computeShippingFee(TIERS[1], 5.5005);
    expect(Number.isInteger(fee)).toBe(true);
    expect(fee).toBe(Math.round(20000 + 0.5005 * 3000));
  });
});

describe('quy tắc phí lấy cây theo cấu hình LanCare', () => {
  const pricing: ShippingTier[] = [
    { minKm: '0', maxKm: '1', baseFee: '100000', perKmFee: '0' },
    { minKm: '1', maxKm: '5', baseFee: '300000', perKmFee: '0' },
    { minKm: '5', maxKm: '10', baseFee: '1000000', perKmFee: '0' },
    { minKm: '10', maxKm: null, baseFee: '1000000', perKmFee: '500000', billingUnitKm: '5' },
  ];

  it('nhân phí theo số lượng cây', () => {
    expect(computeShippingFee(pickTier(pricing, 4)!, 4, 3)).toBe(900000);
  });

  it('trên 10 km cộng 500.000đ cho mỗi block 5 km, rồi nhân số cây', () => {
    expect(computeShippingFee(pickTier(pricing, 10)!, 10, 1)).toBe(1000000);
    expect(computeShippingFee(pickTier(pricing, 10.1)!, 10.1, 1)).toBe(1500000);
    expect(computeShippingFee(pickTier(pricing, 16)!, 16, 2)).toBe(4000000);
  });
});

describe('haversineKm (fallback đường chim bay khi thiếu Google key)', () => {
  it('cùng 1 điểm → 0 km', () => {
    const p = { lat: 10.7769, lng: 106.7009 };
    expect(haversineKm(p, p)).toBe(0);
  });

  it('Bến Thành → Củ Chi ~ 35–45 km chim bay (sanity check thực địa)', () => {
    const benThanh = { lat: 10.7723, lng: 106.698 };
    const cuChi = { lat: 11.0123, lng: 106.4921 };
    const km = haversineKm(benThanh, cuChi);
    expect(km).toBeGreaterThan(30);
    expect(km).toBeLessThan(45);
  });

  it('đối xứng: A→B = B→A', () => {
    const a = { lat: 10.5, lng: 106.5 };
    const b = { lat: 11.2, lng: 107.1 };
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });

  it('hệ số bù đường thực tế là 1.3 (SPEC_MASTER)', () => {
    expect(ROAD_FACTOR).toBe(1.3);
  });
});
