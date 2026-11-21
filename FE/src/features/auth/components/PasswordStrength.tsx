'use client';

import { PASSWORD_MIN } from '@/lib/api';

// Thanh báo độ mạnh mật khẩu (chỉ để gợi ý — BE chỉ bắt buộc 8–64 ký tự).
export function passwordScore(value: string): 0 | 1 | 2 | 3 {
  if (!value) return 0;
  if (value.length < PASSWORD_MIN) return 1;
  const mixed = /[A-Za-z]/.test(value) && /\d/.test(value);
  return mixed && value.length >= 10 ? 3 : 2;
}

const LABELS = ['Nên kết hợp chữ và số, từ 10 ký tự trở lên.', `Còn thiếu: ít nhất ${PASSWORD_MIN} ký tự.`, 'Tạm được. Thêm số hoặc dài hơn để an toàn hơn.', 'Mật khẩu mạnh.'];
const COLORS = ['', 'bg-[#C0262D]', 'bg-[#D97706]', 'bg-[#059669]'];

export default function PasswordStrength({ value }: { value: string }) {
  const score = passwordScore(value);
  return (
    <div className="mt-1.5 space-y-1" aria-live="polite">
      <div className="flex gap-1">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full ${score >= i ? COLORS[score] : 'bg-[#ECE7FA]'}`} />
        ))}
      </div>
      <p className="text-[11px] text-[#6E6A8A] m-0">{LABELS[score]}</p>
    </div>
  );
}
