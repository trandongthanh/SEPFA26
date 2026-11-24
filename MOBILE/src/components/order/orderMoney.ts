// Tiền BE trả là chuỗi số đồng (bigint) — chỉ đổi sang số để hiển thị.
export const toNumber = (value?: string | number | null): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// Phí dịch vụ 6% khách trả — đúng BE customerFeeFor/halfUpPercent: (a × 6 × 2 + 100) / 200, chia nguyên.
// BE lập hoá đơn với a = provisionalTotal (giá gói × số cây). Vd 400.000 → 24.000.
export const customerFeeFor = (packageTotal: number): number =>
  Math.floor((packageTotal * 6 * 2 + 100) / 200);

export const formatVnd =(value?: string | number | null): string =>
  `${toNumber(value).toLocaleString('vi-VN')}đ`;

export const formatDateTime = (iso?: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    : '';
