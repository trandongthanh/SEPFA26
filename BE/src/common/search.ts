/**
 * Tìm kiếm không phân biệt dấu, không phân biệt hoa thường — dùng chung cho các danh sách có ô tìm
 * (GET /orders, GET /care-reports). Không cần extension `unaccent` của Postgres (không phải chạy gì thêm
 * trên DB deploy): bỏ dấu hai phía bằng cùng một bảng ký tự —
 *   phía DB:   unaccentSql('o.order_code') → lower(translate(o.order_code, '<có dấu>', '<không dấu>'))
 *   phía từ khoá: toSearchKey('Lan Hồ') → 'lan ho'
 * rồi so `unaccentSql(cột) LIKE likePattern(q)`. Ví dụ gõ "lan ho" ra cây "Lan Hồ Điệp".
 */

// Chữ thường có dấu của tiếng Việt (kể cả đ). Chữ hoa có dấu sinh từ đây để hai bảng luôn khớp.
const VI_LOWER =
  'àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ';

// Bỏ dấu một chuỗi: tách dấu (NFD) rồi xoá dấu ghép; đ/Đ không có dạng tách nên đổi tay.
const stripAccents = (value: string): string =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');

// Gồm cả chữ HOA có dấu → không phụ thuộc lower() của DB với ký tự ngoài ASCII (tuỳ locale).
export const VI_ACCENTED = VI_LOWER + VI_LOWER.toUpperCase();
export const VI_PLAIN = [...VI_ACCENTED]
  .map((char) => stripAccents(char).toLowerCase())
  .join('');

/**
 * Biểu thức SQL bỏ dấu + chữ thường của một cột. `column` là tên cột do code viết (không phải input
 * người dùng); hai bảng ký tự là hằng số, không chứa dấu nháy.
 */
export function unaccentSql(column: string): string {
  return `lower(translate(${column}, '${VI_ACCENTED}', '${VI_PLAIN}'))`;
}

/**
 * Chuẩn hoá từ khoá: bỏ dấu, chữ thường, gộp khoảng trắng, escape ký tự đặc biệt của LIKE (\ % _)
 * để "50%" tìm đúng chuỗi "50%". Ví dụ "  Lan  Hồ " → "lan ho".
 */
export function toSearchKey(q: string): string {
  return stripAccents(q)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Mẫu LIKE "chứa từ khoá"; từ khoá rỗng (chỉ có khoảng trắng) → null = không lọc. */
export function likePattern(q: string | undefined): string | null {
  if (q === undefined) return null;
  const key = toSearchKey(q);
  return key === '' ? null : `%${key}%`;
}
