import { computeCareReportSchedule } from './care-report-schedule';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-11-01T00:00:00Z');
const due = new Date(start.getTime() + 30 * DAY);

describe('computeCareReportSchedule', () => {
  it('chưa bắt đầu chăm → null', () => {
    expect(
      computeCareReportSchedule({
        status: 'PAID',
        careStartedAt: null,
        careDueAt: null,
        reportFrequencyDays: 7,
        submittedCount: 0,
      }),
    ).toBeNull();
  });

  it('chăm 15 ngày, báo cáo 7 ngày/lần, mới gửi 1 → trễ, kỳ tới ngày 14', () => {
    const r = computeCareReportSchedule({
      status: 'IN_CARE',
      careStartedAt: start,
      careDueAt: due,
      reportFrequencyDays: 7,
      submittedCount: 1,
      now: new Date(start.getTime() + 15 * DAY),
    })!;
    expect(r.expectedCount).toBe(2);
    expect(r.isReportOverdue).toBe(true);
    expect(r.nextReportDueAt).toEqual(new Date(start.getTime() + 14 * DAY));
  });

  it('gửi đủ → không trễ', () => {
    const r = computeCareReportSchedule({
      status: 'IN_CARE',
      careStartedAt: start,
      careDueAt: due,
      reportFrequencyDays: 7,
      submittedCount: 2,
      now: new Date(start.getTime() + 15 * DAY),
    })!;
    expect(r.isReportOverdue).toBe(false);
  });

  it('quá hạn chăm: tính cả kỳ cuối ngắn (30 ngày / 7 → 5 kỳ), kỳ tới không vượt care_due_at', () => {
    const r = computeCareReportSchedule({
      status: 'IN_CARE',
      careStartedAt: start,
      careDueAt: due,
      reportFrequencyDays: 7,
      submittedCount: 4,
      now: new Date(start.getTime() + 40 * DAY),
    })!;
    expect(r.expectedCount).toBe(5);
    expect(r.totalPeriods).toBe(5);
    expect(r.isReportOverdue).toBe(true);
    expect(r.nextReportDueAt).toEqual(due);
  });

  it('đã nộp đủ mọi kỳ → không trễ, không còn kỳ tới', () => {
    const r = computeCareReportSchedule({
      status: 'IN_CARE',
      careStartedAt: start,
      careDueAt: due,
      reportFrequencyDays: 7,
      submittedCount: 5,
      now: new Date(start.getTime() + 40 * DAY),
    })!;
    expect(r.isReportOverdue).toBe(false);
    expect(r.nextReportDueAt).toBeNull();
  });

  it('đơn đã rời IN_CARE → không trễ, không có kỳ tới', () => {
    const r = computeCareReportSchedule({
      status: 'COMPLETED',
      careStartedAt: start,
      careDueAt: due,
      reportFrequencyDays: 7,
      submittedCount: 0,
      now: new Date(start.getTime() + 40 * DAY),
    })!;
    expect(r.isReportOverdue).toBe(false);
    expect(r.nextReportDueAt).toBeNull();
  });
});
