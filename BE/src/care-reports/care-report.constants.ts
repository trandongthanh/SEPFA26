// Thang đo của báo cáo chăm sóc — theo bộ chỉ số leader lấy từ nhà vườn (12/11/2026).

/** Độ ẩm giá thể (đo trong từng chậu): Thấp / Vừa / Cao. */
export const SUBSTRATE_MOISTURE = ['LOW', 'MEDIUM', 'HIGH'] as const;
export type SubstrateMoisture = (typeof SUBSTRATE_MOISTURE)[number];

/** Tình trạng lá / rễ / thân: Tốt / Bình thường / Xấu. */
export const PART_CONDITION = ['GOOD', 'NORMAL', 'POOR'] as const;
export type PartCondition = (typeof PART_CONDITION)[number];

/** Sức khỏe tổng thể: Tốt / Trung bình / Kém. */
export const OVERALL_HEALTH = ['GOOD', 'AVERAGE', 'POOR'] as const;
export type OverallHealth = (typeof OVERALL_HEALTH)[number];

/** Loại ảnh minh chứng của từng cây. */
export const EVIDENCE_TYPES = ['OVERVIEW', 'LEAF', 'STEM', 'ROOT'] as const;
export type EvidenceType = (typeof EVIDENCE_TYPES)[number];

/** Cột numeric của Postgres trả về string → đổi về number khi đọc. */
export const numericColumn = {
  to: (value: number | null | undefined) => value,
  from: (value: string | null) => (value === null ? null : Number(value)),
};
