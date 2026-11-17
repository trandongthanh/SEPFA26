import { declaredDepositFor, sumDeclaredDeposits } from './declared-deposit';

describe('declaredDepositFor', () => {
  const BASE = 200_000n;
  const RULE = { percent: 10n, minMultiplier: 2n };

  it('cây không khai giá → 0', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: false, declaredValue: null },
        BASE,
        RULE,
      ),
    ).toBe(0n);
  });

  it('dữ liệu cũ: bật cờ khai giá mà thiếu số → 0', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: null },
        BASE,
        RULE,
      ),
    ).toBe(0n);
  });

  it('khai đúng bằng 2 × giá gói → chưa vượt ngưỡng → 0', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '400000' },
        BASE,
        RULE,
      ),
    ).toBe(0n);
  });

  it('khai vượt ngưỡng 1 đồng → 10% làm tròn HALF_UP (400.001 → 40.000)', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '400001' },
        BASE,
        RULE,
      ),
    ).toBe(40_000n);
    // 400.005 × 10% = 40.000,5 → 40.001
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '400005' },
        BASE,
        RULE,
      ),
    ).toBe(40_001n);
  });

  it('đơn mẫu: cây A khai 3.000.000 → 300.000', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '3000000' },
        BASE,
        RULE,
      ),
    ).toBe(300_000n);
  });

  it('percent = 0 → tắt tính năng, mọi cây 0', () => {
    expect(
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '3000000' },
        BASE,
        { percent: 0n, minMultiplier: 2n },
      ),
    ).toBe(0n);
  });

  it('số âm → RangeError', () => {
    expect(() =>
      declaredDepositFor(
        { isValueDeclared: true, declaredValue: '3000000' },
        BASE,
        { percent: -1n, minMultiplier: 2n },
      ),
    ).toThrow(RangeError);
  });

  it('đơn mẫu: cây A khai 3.000.000 + cây B không khai → tổng 300.000', () => {
    expect(
      sumDeclaredDeposits(
        [
          { isValueDeclared: true, declaredValue: '3000000' },
          { isValueDeclared: false, declaredValue: null },
        ],
        BASE,
        RULE,
      ),
    ).toBe(300_000n);
    expect(sumDeclaredDeposits([], BASE, RULE)).toBe(0n);
  });
});
