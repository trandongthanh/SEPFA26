import { extractOrderCode, generateOrderCode } from './order-code';

describe('generateOrderCode', () => {
  it('đúng format LANCARE + 8 hex hoa', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateOrderCode()).toMatch(/^LANCARE[0-9A-F]{8}$/);
    }
  });

  it('2 lần sinh liên tiếp ra mã khác nhau (ngẫu nhiên thật, không phụ thuộc đồng hồ)', () => {
    expect(generateOrderCode()).not.toBe(generateOrderCode());
  });
});

describe('extractOrderCode', () => {
  it('nội dung CK sạch → lấy đúng mã', () => {
    expect(extractOrderCode('LANCARE1A2B3C4D')).toBe('LANCARE1A2B3C4D');
  });

  it('nội dung CK nhiễu kiểu ngân hàng (tiền tố/hậu tố) → vẫn lấy đúng', () => {
    expect(
      extractOrderCode('MBVCB.123456.CK don LANCAREAB12CD34.CT tu 0123'),
    ).toBe('LANCAREAB12CD34');
  });

  it('không phân biệt hoa thường → chuẩn hóa về hoa', () => {
    expect(extractOrderCode('ck lancareab12cd34')).toBe('LANCAREAB12CD34');
  });

  it('không có mã / mã cụt → null', () => {
    expect(extractOrderCode('chuyen tien mua lan')).toBeNull();
    expect(extractOrderCode('LANCARE12345')).toBeNull(); // thiếu ký tự
  });

  it('ký tự ngoài hex không tính vào mã', () => {
    expect(extractOrderCode('LANCAREGGGGGGGG')).toBeNull();
  });
});
