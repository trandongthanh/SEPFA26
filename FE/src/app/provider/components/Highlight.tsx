'use client';

import React from 'react';
import { findFoldedRange } from '@/lib/search';

/** Tô vàng phần khớp từ khoá (không phân biệt dấu). Không khớp → in nguyên chuỗi. */
export default function Highlight({ text, query }: { text: string | null | undefined; query: string }) {
  const value = text ?? '';
  const range = findFoldedRange(value, query);
  if (!range) return <>{value}</>;
  const [start, end] = range;
  return (
    <>
      {value.slice(0, start)}
      <mark className="bg-[#FEF08A] text-inherit rounded-[3px] px-px">{value.slice(start, end)}</mark>
      {value.slice(end)}
    </>
  );
}
