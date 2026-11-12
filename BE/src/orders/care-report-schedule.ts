// Tiến độ báo cáo chăm sóc của đơn — hàm thuần, tính lúc đọc, không lưu DB.
// Chỉ cần số báo cáo đã gửi (đếm bảng care_reports). Kỳ tính chung với lúc nộp
// (`care-reports/care-period.ts`) để kỳ cuối ngắn hơn tần suất vẫn được tính.
import {
  computeCarePeriod,
  countEndedPeriods,
  countTotalPeriods,
} from '../care-reports/care-period';

export interface CareReportSchedule {
  /** Hạn kỳ báo cáo kế tiếp; null khi đơn không còn IN_CARE hoặc đã nộp đủ kỳ. */
  nextReportDueAt: Date | null;
  /** Đơn IN_CARE mà số báo cáo đã gửi ít hơn số kỳ đã kết thúc. */
  isReportOverdue: boolean;
  submittedCount: number;
  /** Số kỳ đã kết thúc tính tới min(bây giờ, care_due_at). */
  expectedCount: number;
  /** Tổng số kỳ của gói (kỳ cuối có thể ngắn) — FE hiện "kỳ 2/5". */
  totalPeriods: number;
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
  const window = { careStartedAt, careDueAt, reportFrequencyDays };
  const now = input.now ?? new Date();
  const expectedCount = countEndedPeriods(window, now);
  const inCare = status === 'IN_CARE';
  const next = computeCarePeriod(window, submittedCount + 1);
  return {
    nextReportDueAt: inCare && next ? next.end : null,
    isReportOverdue: inCare && submittedCount < expectedCount,
    submittedCount,
    expectedCount,
    totalPeriods: countTotalPeriods(window),
  };
}
