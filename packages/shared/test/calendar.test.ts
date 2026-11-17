import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildCalendar,
  computePlan,
  eachDate,
  fixedHolidaysBetween,
  formatDate,
  groupIntoWeeks,
  isIsoDate,
  weekdayOf,
  weekStartOf,
} from '../src/index.js';

describe('dates', () => {
  it('parses and validates calendar dates', () => {
    expect(isIsoDate('2026-02-01')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('01/02/2026')).toBe(false);
  });

  it('adds days across month boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('uses ISO weekdays', () => {
    expect(weekdayOf('2026-02-02')).toBe(1); // Monday
    expect(weekdayOf('2026-02-08')).toBe(7); // Sunday
    expect(weekStartOf('2026-02-05')).toBe('2026-02-02');
    expect(formatDate('2026-02-05')).toBe('5 Feb 2026');
  });

  it('formats full timestamps and tolerates junk', () => {
    expect(formatDate('2026-02-05T13:45:00.000Z')).toBe('5 Feb 2026');
    expect(formatDate('not-a-date')).toBe('not-a-date');
  });

  it('enumerates a range inclusively', () => {
    expect(eachDate('2026-02-01', '2026-02-04')).toHaveLength(4);
    expect(eachDate('2026-02-04', '2026-02-01')).toEqual([]);
  });
});

describe('calendar', () => {
  it('excludes weekends and holidays', () => {
    const result = buildCalendar({
      startDate: '2026-02-02',
      endDate: '2026-02-15',
      workingDays: [1, 2, 3, 4, 5],
      holidays: ['2026-02-06'],
      extraDaysOff: ['2026-02-10'],
    });
    const dates = result.workingDates;
    expect(dates).toHaveLength(8);
    expect(dates).not.toContain('2026-02-07'); // Saturday
    expect(dates).not.toContain('2026-02-06');
    expect(dates).not.toContain('2026-02-10');
    expect(result.excluded.find((entry) => entry.date === '2026-02-07')?.reason).toBe('weekend');
  });

  it('supports a six-day week', () => {
    const result = buildCalendar({
      startDate: '2026-02-02',
      endDate: '2026-02-08',
      workingDays: [1, 2, 3, 4, 5, 6],
    });
    expect(result.workingDates).toHaveLength(6);
    expect(result.workingDates).not.toContain('2026-02-08');
  });

  it('groups Monday-start weeks and numbers them', () => {
    const groups = groupIntoWeeks([
      '2026-02-02',
      '2026-02-03',
      '2026-02-09',
      '2026-03-01',
    ]);
    expect(groups.map((group) => group.weekNumber)).toEqual([1, 2, 3]);
    expect(groups[0]?.startDate).toBe('2026-02-02');
    expect(groups[2]?.startDate).toBe('2026-02-23');
  });

  it('suggests fixed Nigerian holidays in range', () => {
    const holidays = fixedHolidaysBetween('2026-01-01', '2026-12-31');
    const dates = holidays.map((holiday) => holiday.date);
    expect(dates).toContain('2026-01-01');
    expect(dates).toContain('2026-06-12');
    expect(dates).toContain('2026-10-01');
    expect(dates).toContain('2026-12-26');
  });
});

describe('plan', () => {
  it('computes weeks and the flat cost', () => {
    const plan = computePlan({
      startDate: '2026-02-02',
      endDate: '2026-02-27',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(plan.weeks).toBe(4);
    expect(plan.cost).toBe(100);
    expect(plan.workingDates).toHaveLength(20);
    expect(plan.warnings).toEqual([]);
  });

  it('warns when the template has fewer units than the placement', () => {
    const plan = computePlan({
      startDate: '2026-02-02',
      endDate: '2026-03-27',
      workingDays: [1, 2, 3, 4, 5],
      maxUnits: 4,
    });
    expect(plan.weeks).toBe(8);
    expect(plan.warnings[0]).toMatch(/room for 4 weeks/);
  });

  it('warns when there are no working days', () => {
    const plan = computePlan({
      startDate: '2026-02-07',
      endDate: '2026-02-08',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(plan.weeks).toBe(0);
    expect(plan.warnings[0]).toMatch(/No working days/);
  });

  it('charges the 9-16 week tier', () => {
    const plan = computePlan({
      startDate: '2026-02-02',
      endDate: '2026-04-10',
      workingDays: [1, 2, 3, 4, 5],
    });
    expect(plan.weeks).toBe(10);
    expect(plan.cost).toBe(180);
  });
});
