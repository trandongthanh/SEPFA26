import { extractAddonCode } from './addon-rules';
import {
  extractOrderCode,
  extractSecurityDepositCode,
  generateOrderCode,
  generateSecurityDepositCode,
} from './order-code';

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

describe('mã tiền bảo đảm BAODAM', () => {
  it('đúng format BAODAM + 8 hex hoa, mỗi lần sinh một mã khác', () => {
    for (let i = 0; i < 50; i++) {
      expect(generateSecurityDepositCode()).toMatch(/^BAODAM[0-9A-F]{8}$/);
    }
    expect(generateSecurityDepositCode()).not.toBe(
      generateSecurityDepositCode(),
    );
  });

  it('tách được mã từ nội dung CK nhiễu, chuẩn hoá về chữ hoa', () => {
    expect(extractSecurityDepositCode('BAODAM5E6F7A8B')).toBe('BAODAM5E6F7A8B');
    expect(
      extractSecurityDepositCode('MBVCB.123.CK baodam5e6f7a8b nop bao dam.CT'),
    ).toBe('BAODAM5E6F7A8B');
  });

  it('không có mã / mã cụt / ký tự ngoài hex → null', () => {
    expect(extractSecurityDepositCode('nop tien bao dam')).toBeNull();
    expect(extractSecurityDepositCode('BAODAM5E6F7A')).toBeNull();
    expect(extractSecurityDepositCode('BAODAMGGGGGGGG')).toBeNull();
  });

  it('không nhầm với mã đơn và mã add-on (cả hai chiều)', () => {
    // Mã đơn / add-on không bị đọc thành mã bảo đảm.
    expect(extractSecurityDepositCode('CK LANCARE7A2B9C1D')).toBeNull();
    expect(extractSecurityDepositCode('CK ADDON1A2B3C4D')).toBeNull();
    // Mã bảo đảm không bị đọc thành mã đơn / add-on.
    for (let i = 0; i < 50; i++) {
      const code = generateSecurityDepositCode();
      expect(extractOrderCode(`CK ${code} nop bao dam`)).toBeNull();
      expect(extractAddonCode(`CK ${code} nop bao dam`)).toBeNull();
    }
  });
});
