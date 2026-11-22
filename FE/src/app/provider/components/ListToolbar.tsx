'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Input, type InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';

export interface ToolbarChip {
  value: string;
  label: string;
  count: number;
}

interface ListToolbarProps {
  query: string;
  onQueryChange: (value: string) => void;
  placeholder: string;
  chips?: ToolbarChip[];
  activeChip?: string;
  onChipChange?: (value: string) => void;
  /** Ô phụ cạnh ô tìm (sắp xếp, chọn đơn...). */
  extra?: React.ReactNode;
}

const DEBOUNCE_MS = 300;

/**
 * Thanh công cụ đặt ngay trên danh sách: ô tìm (lọc sau 0,3 giây kể từ phím cuối, phím "/" để
 * nhảy vào ô) + lọc nhanh có số đếm. Dùng chung cho Đơn hàng, Gói chăm sóc, Báo cáo chăm sóc.
 */
export default function ListToolbar({
  query,
  onQueryChange,
  placeholder,
  chips,
  activeChip,
  onChipChange,
  extra,
}: ListToolbarProps) {
  const [draft, setDraft] = useState(query);
  const inputRef = useRef<InputRef>(null);

  // Trang xoá bộ lọc từ ngoài (nút "Xoá bộ lọc") → ô tìm cũng trống theo.
  useEffect(() => {
    setDraft(query);
  }, [query]);

  useEffect(() => {
    if (draft === query) return;
    const timer = window.setTimeout(() => onQueryChange(draft.trim() ? draft : ''), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== '/' || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      event.preventDefault();
      inputRef.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="bg-white p-3 rounded-2xl border border-[#ECE7FA] shadow-xs flex flex-col gap-2.5">
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          ref={inputRef}
          type="search"
          size="large"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            // Bấm nút ✕ của ô → xoá ngay, không chờ.
            if (!e.target.value) onQueryChange('');
          }}
          placeholder={placeholder}
          aria-label={placeholder}
          allowClear
          prefix={<SearchOutlined className="text-[#A098C2] mr-1" />}
          suffix={
            draft ? null : (
              <kbd className="font-mono text-[11px] text-[#A098C2] border border-[#ECE7FA] rounded-md px-1.5 bg-white leading-5">
                /
              </kbd>
            )
          }
          className="!rounded-xl !bg-[#F6F4FC] !border-[#E3DEF3] text-sm flex-[1_1_280px] min-w-0"
        />
        {extra}
      </div>

      {chips && chips.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Lọc nhanh">
          {chips.map((chip) => {
            const active = chip.value === activeChip;
            return (
              <button
                key={chip.value}
                type="button"
                aria-pressed={active}
                onClick={() => onChipChange?.(chip.value)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1 text-[12.5px] font-semibold cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#6027D2] ${
                  active
                    ? 'bg-[#6027D2] border-[#6027D2] text-white'
                    : 'bg-white border-[#ECE7FA] text-[#4B4764] hover:border-[#C4B5FD]'
                }`}
              >
                {chip.label}
                <b className={`tabular-nums font-bold ${active ? 'text-[#E9D5FF]' : 'text-[#A098C2]'}`}>{chip.count}</b>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Ô trống khi lọc không ra kết quả. */
export function NoResults({ label, onReset }: { label: string; onReset: () => void }) {
  return (
    <div className="bg-white rounded-2xl p-10 text-center border border-[#ECE7FA] flex flex-col items-center gap-2">
      <p className="m-0 text-sm text-[#6E6A8A]">
        Không có kết quả cho <b className="text-[#1E1B2E]">&ldquo;{label}&rdquo;</b>
      </p>
      <button
        type="button"
        onClick={onReset}
        className="text-[13px] font-semibold text-[#6027D2] bg-[#F3E8FF] rounded-[10px] px-3 py-1.5 cursor-pointer hover:bg-[#E9D5FF]"
      >
        Xoá bộ lọc
      </button>
    </div>
  );
}
