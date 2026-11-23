import {
  VI_ACCENTED,
  VI_PLAIN,
  likePattern,
  toSearchKey,
  unaccentSql,
} from './search';

describe('search — tìm không dấu', () => {
  it('toSearchKey: bỏ dấu, chữ thường, gộp khoảng trắng', () => {
    expect(toSearchKey('Lan Hồ Điệp')).toBe('lan ho diep');
    expect(toSearchKey('Đà Lạt')).toBe('da lat');
    expect(toSearchKey('  Lan   Hồ ')).toBe('lan ho');
    expect(toSearchKey('LANCARE7A2B9C1D')).toBe('lancare7a2b9c1d');
  });

  it('toSearchKey: escape ký tự đặc biệt của LIKE', () => {
    expect(toSearchKey('50%')).toBe('50\\%');
    expect(toSearchKey('a_b')).toBe('a\\_b');
    expect(toSearchKey('a\\b')).toBe('a\\\\b');
  });

  it('likePattern: rỗng hoặc chỉ khoảng trắng → null (không lọc)', () => {
    expect(likePattern(undefined)).toBeNull();
    expect(likePattern('   ')).toBeNull();
    expect(likePattern('lan hồ')).toBe('%lan ho%');
  });

  it('bảng ký tự SQL khớp từng ký tự với cách bỏ dấu phía JS', () => {
    const accented = [...VI_ACCENTED];
    const plain = [...VI_PLAIN];
    // 67 chữ thường có dấu (kể cả đ) + 67 chữ hoa
    expect(accented).toHaveLength(134);
    expect(plain).toHaveLength(accented.length);
    accented.forEach((char, index) => {
      expect(toSearchKey(char)).toBe(plain[index]);
    });
    expect(VI_PLAIN).toMatch(/^[a-z]+$/);
  });

  it('unaccentSql: bọc cột trong lower(translate(...)), không có dấu nháy lạ', () => {
    const sql = unaccentSql('o.order_code');
    expect(sql.startsWith('lower(translate(o.order_code, ')).toBe(true);
    expect(sql.match(/'/g)).toHaveLength(4);
  });
});
