import { compensationCapFor, sumCompensationCaps } from './compensation-cap';

describe('compensationCapFor', () => {
  const BASE = 200_000n;

  it('cây có khai giá → mức đền = giá khai', () => {
    expect(
      compensationCapFor(
        { isValueDeclared: true, declaredValue: '3000000' },
        BASE,
      ),
    ).toBe(3_000_000n);
  });

  it('cây không khai giá → 2 × giá gói', () => {
    expect(
      compensationCapFor({ isValueDeclared: false, declaredValue: null }, BASE),
    ).toBe(400_000n);
  });

  it('dữ liệu cũ: bật cờ khai giá mà thiếu số → coi như không khai', () => {
    expect(
      compensationCapFor({ isValueDeclared: true, declaredValue: null }, BASE),
    ).toBe(400_000n);
  });

  it('đơn mẫu: cây A khai 3.000.000 + cây B không khai → tiền bảo đảm 3.400.000', () => {
    expect(
      sumCompensationCaps(
        [
          { isValueDeclared: true, declaredValue: '3000000' },
          { isValueDeclared: false, declaredValue: null },
        ],
        BASE,
      ),
    ).toBe(3_400_000n);
    expect(sumCompensationCaps([], BASE)).toBe(0n);
  });
});
