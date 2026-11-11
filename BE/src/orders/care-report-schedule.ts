// Tiến độ báo cáo chăm sóc của đơn — hàm thuần, tính lúc đọc, không lưu DB.
// Chỉ cần số báo cáo đã gửi (đếm bảng care_reports của module care-reports, chỉ đọc).

const DAY_MS = 24 * 60 * 60 * 1000;

export interface CareReportSchedule {
  /** Hạn kỳ báo cáo kế tiếp; null khi đơn không còn IN_CARE. */
  nextReportDueAt: Date | null;
  /** Đơn IN_CARE mà số báo cáo đã gửi ít hơn số kỳ đã trôi qua. */
  isReportOverdue: boolean;
  submittedCount: number;
  /** Số kỳ đã trôi qua tính tới min(bây giờ, care_due_at). */
  expectedCount: number;
}

export function computeCareReportSchedule(input: {
  status: string;
  careStartedAt: Date | null;
  careDueAt: Date | null;
  reportFrequencyDays: number;
  submittedCount: number;
  now?: Date;
}): CareReportSchedule | null {
  const {
    status,
    careStartedAt,
    careDueAt,
    reportFrequencyDays,
    submittedCount,
  } = input;
  if (!careStartedAt || !careDueAt || reportFrequencyDays <= 0) {
    return null;
  }
  const now = (input.now ?? new Date()).getTime();
  const periodMs = reportFrequencyDays * DAY_MS;
  const until = Math.min(now, careDueAt.getTime());
  const expectedCount = Math.max(
    0,
    Math.floor((until - careStartedAt.getTime()) / periodMs),
  );
  const inCare = status === 'IN_CARE';
  const nextDue = Math.min(
    careStartedAt.getTime() + (submittedCount + 1) * periodMs,
    careDueAt.getTime(),
  );
  return {
    nextReportDueAt: inCare ? new Date(nextDue) : null,
    isReportOverdue: inCare && submittedCount < expectedCount,
    submittedCount,
    expectedCount,
  };
}
