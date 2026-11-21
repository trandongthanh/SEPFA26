import {
  computeCarePeriod,
  countEndedPeriods,
  countTotalPeriods,
} from './care-period';

const DAY = 24 * 60 * 60 * 1000;
const start = new Date('2026-12-01T01:00:00Z');
const window30x7 = {
  careStartedAt: start,
  careDueAt: new Date(start.getTime() + 30 * DAY),
  reportFrequencyDays: 7,
};

describe('care-period', () => {
  it('gói 30 ngày, 7 ngày/lần → 5 kỳ, kỳ 5 chỉ dài 2 ngày và kết thúc đúng hạn chăm', () => {
    expect(countTotalPeriods(window30x7)).toBe(5);
    const p1 = computeCarePeriod(window30x7, 1)!;
    expect(p1.start).toEqual(start);
    expect(p1.end.getTime() - p1.start.getTime()).toBe(7 * DAY);
    const p5 = computeCarePeriod(window30x7, 5)!;
    expect(p5.start.getTime()).toBe(start.getTime() + 28 * DAY);
    expect(p5.end).toEqual(window30x7.careDueAt);
    expect(p5.end.getTime() - p5.start.getTime()).toBe(2 * DAY);
  });

  it('gói chia hết (28 ngày, 7 ngày/lần) → 4 kỳ đều nhau', () => {
    const w = {
      ...window30x7,
      careDueAt: new Date(start.getTime() + 28 * DAY),
    };
    expect(countTotalPeriods(w)).toBe(4);
    const p4 = computeCarePeriod(w, 4)!;
    expect(p4.end.getTime() - p4.start.getTime()).toBe(7 * DAY);
  });

  it('tần suất ≥ thời hạn gói → đúng 1 kỳ, cắt ở hạn chăm', () => {
    const w = { ...window30x7, careDueAt: new Date(start.getTime() + 3 * DAY) };
    expect(countTotalPeriods(w)).toBe(1);
    expect(computeCarePeriod(w, 1)!.end).toEqual(w.careDueAt);
  });

  it('index ngoài khoảng → null', () => {
    expect(computeCarePeriod(window30x7, 0)).toBeNull();
    expect(computeCarePeriod(window30x7, 6)).toBeNull();
    expect(computeCarePeriod(window30x7, 1.5)).toBeNull();
  });

  it('mốc sai → 0 kỳ', () => {
    expect(countTotalPeriods({ ...window30x7, careDueAt: start })).toBe(0);
    expect(countTotalPeriods({ ...window30x7, reportFrequencyDays: 0 })).toBe(
      0,
    );
  });

  it('đếm kỳ đã kết thúc: ngày 6 = 0; ngày 15 = 2; ngày 29 = 4; tới hạn chăm = 5 (tính kỳ cuối ngắn)', () => {
    expect(
      countEndedPeriods(window30x7, new Date(start.getTime() + 6 * DAY)),
    ).toBe(0);
    expect(
      countEndedPeriods(window30x7, new Date(start.getTime() + 15 * DAY)),
    ).toBe(2);
    expect(
      countEndedPeriods(window30x7, new Date(start.getTime() + 29 * DAY)),
    ).toBe(4);
    expect(countEndedPeriods(window30x7, window30x7.careDueAt)).toBe(5);
    expect(countEndedPeriods(window30x7, new Date(start.getTime() - DAY))).toBe(
      0,
    );
  });
});
