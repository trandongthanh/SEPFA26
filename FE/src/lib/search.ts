'use client';

import { useCallback, useState } from 'react';

/**
 * Tìm kiếm phía FE cho các trang danh sách (BE chưa có tham số tìm theo từ khoá).
 * Không phân biệt hoa thường và dấu tiếng Việt: "ho diep" khớp "Hồ Điệp".
 */

/** Bỏ dấu + chữ thường: "Hồ Điệp" → "ho diep". */
export function foldVi(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Có trường nào chứa từ khoá không (từ khoá rỗng → luôn khớp). */
export function matchesQuery(query: string, ...fields: Array<string | null | undefined>): boolean {
  const needle = foldVi(query.trim());
  if (!needle) return true;
  return fields.some((field) => field && foldVi(field).includes(needle));
}

/**
 * Vị trí [start, end) của lần khớp đầu tiên trong chuỗi GỐC (còn dấu) để tô vàng.
 * Bỏ dấu từng ký tự rồi ghi lại ký tự gốc tương ứng → không lệch vị trí dù chuỗi gốc có dấu.
 */
export function findFoldedRange(text: string, query: string): [number, number] | null {
  const needle = foldVi(query.trim());
  if (!needle) return null;
  let folded = '';
  const origin: number[] = []; // folded[i] đến từ ký tự gốc bắt đầu ở text[origin[i]]
  const originEnd: number[] = [];
  let offset = 0;
  for (const ch of text) {
    const f = foldVi(ch);
    for (const fc of f) {
      folded += fc;
      origin.push(offset);
      originEnd.push(offset + ch.length);
    }
    offset += ch.length;
  }
  const at = folded.indexOf(needle);
  if (at < 0) return null;
  return [origin[at], originEnd[at + needle.length - 1]];
}

/**
 * Giữ một tham số trên URL (vd ?q=lc-241) để F5 / quay lại trang không mất từ khoá.
 * Đọc lúc mở trang, ghi bằng history.replaceState (không thêm lịch sử, không tải lại trang).
 */
export function useUrlParam(key: string): [string, (value: string) => void] {
  const [value, setValue] = useState(() => {
    if (typeof window === 'undefined') return '';
    return new URLSearchParams(window.location.search).get(key) ?? '';
  });

  const update = useCallback(
    (next: string) => {
      setValue(next);
      if (typeof window === 'undefined') return;
      const url = new URL(window.location.href);
      if (next) url.searchParams.set(key, next);
      else url.searchParams.delete(key);
      window.history.replaceState(window.history.state, '', url.toString());
    },
    [key],
  );

  return [value, update];
}
