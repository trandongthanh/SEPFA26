// Kỳ báo cáo chăm sóc — hàm thuần, server tự tính (client không gửi kỳ).
// Kỳ n: start = care_started_at + (n−1)·tần suất; end = min(start + tần suất, care_due_at).
// Kỳ cuối được phép ngắn hơn tần suất (vd gói 30 ngày, 7 ngày/lần → kỳ 5 dài 2 ngày).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CareWindow {
  careStartedAt: Date;
  careDueAt: Date;
  reportFrequencyDays: number;
}

export interface CarePeriod {
  index: number;
  start: Date;
  end: Date;
}

/** Tổng số kỳ của gói (kỳ cuối có thể ngắn). Mốc sai (hạn ≤ bắt đầu, tần suất ≤ 0) → 0. */
export function countTotalPeriods(window: CareWindow): number {
  const span = window.careDueAt.getTime() - window.careStartedAt.getTime();
  const periodMs = window.reportFrequencyDays * DAY_MS;
  if (span <= 0 || periodMs <= 0) {
    return 0;
  }
  return Math.ceil(span / periodMs);
}

/** Kỳ thứ `index` (bắt đầu từ 1). Index ngoài [1, tổng số kỳ] → null. */
export function computeCarePeriod(
  window: CareWindow,
  index: number,
): CarePeriod | null {
  if (
    !Number.isInteger(index) ||
    index < 1 ||
    index > countTotalPeriods(window)
  ) {
    return null;
  }
  const periodMs = window.reportFrequencyDays * DAY_MS;
  const start = window.careStartedAt.getTime() + (index - 1) * periodMs;
  const end = Math.min(start + periodMs, window.careDueAt.getTime());
  return { index, start: new Date(start), end: new Date(end) };
}

/** Số kỳ đã kết thúc tính tới `now` (kỳ có end ≤ now), tối đa bằng tổng số kỳ. */
export function countEndedPeriods(window: CareWindow, now: Date): number {
  const total = countTotalPeriods(window);
  if (total === 0) {
    return 0;
  }
  if (now.getTime() >= window.careDueAt.getTime()) {
    return total;
  }
  const periodMs = window.reportFrequencyDays * DAY_MS;
  const elapsed = now.getTime() - window.careStartedAt.getTime();
  return Math.max(0, Math.min(total, Math.floor(elapsed / periodMs)));
}
