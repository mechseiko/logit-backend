import { FIXED_HOLIDAYS, WEEKDAY_NAMES } from './constants.js';
import type { Plan, WeekGroup } from './types.js';
import { creditsForWeeks, defaultPricing, type PricingConfig } from './money.js';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && isoDate(parsed) === value;
}

export function parseIsoDate(value: string): Date {
  // Accept both calendar dates ("2026-02-02") and full ISO timestamps.
  return new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
}

export function addDays(value: string, days: number): string {
  const date = parseIsoDate(value);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDate(date);
}

/** ISO weekday: Monday = 1 ... Sunday = 7. */
export function weekdayOf(value: string): number {
  return ((parseIsoDate(value).getUTCDay() + 6) % 7) + 1;
}

export function weekdayName(value: string): string {
  return WEEKDAY_NAMES[parseIsoDate(value).getUTCDay()]!;
}

export function shortWeekdayName(value: string): string {
  return weekdayName(value).slice(0, 3);
}

export function formatDate(value: string): string {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

export function formatDateShort(value: string): string {
  const date = parseIsoDate(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function eachDate(startDate: string, endDate: string): string[] {
  const out: string[] = [];
  if (!isIsoDate(startDate) || !isIsoDate(endDate) || endDate < startDate) return out;
  let cursor = startDate;
  // Hard guard: a placement is never longer than one year.
  for (let i = 0; i < 400 && cursor <= endDate; i += 1) {
    out.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return out;
}

export function fixedHolidaysBetween(startDate: string, endDate: string): { date: string; name: string }[] {
  const years = new Set<string>();
  for (const date of eachDate(startDate, endDate)) years.add(date.slice(0, 4));
  const out: { date: string; name: string }[] = [];
  for (const year of years) {
    for (const holiday of FIXED_HOLIDAYS) {
      const date = `${year}-${String(holiday.month).padStart(2, '0')}-${String(holiday.day).padStart(2, '0')}`;
      if (date >= startDate && date <= endDate) out.push({ date, name: holiday.name });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

export interface CalendarInput {
  startDate: string;
  endDate: string;
  workingDays: number[];
  holidays?: string[];
  extraDaysOff?: string[];
}

export interface CalendarResult {
  workingDates: string[];
  excluded: { date: string; reason: 'weekend' | 'holiday' | 'day-off' | 'not-a-working-day' }[];
}

/**
 * Builds the exact set of dates the student worked.
 * Weekends are simply days not in `workingDays`, so "include Sundays" works by adding 7.
 */
export function buildCalendar(input: CalendarInput): CalendarResult {
  const holidays = new Set(input.holidays ?? []);
  const daysOff = new Set(input.extraDaysOff ?? []);
  const working = new Set(input.workingDays);
  const excluded: CalendarResult['excluded'] = [];
  const workingDates: string[] = [];
  for (const date of eachDate(input.startDate, input.endDate)) {
    if (holidays.has(date)) {
      excluded.push({ date, reason: 'holiday' });
    } else if (daysOff.has(date)) {
      excluded.push({ date, reason: 'day-off' });
    } else if (!working.has(weekdayOf(date))) {
      excluded.push({ date, reason: weekdayOf(date) >= 6 ? 'weekend' : 'not-a-working-day' });
    } else {
      workingDates.push(date);
    }
  }
  return { workingDates, excluded };
}

/** Monday-start week containing the date. */
export function weekStartOf(date: string): string {
  return addDays(date, -(weekdayOf(date) - 1));
}

export function groupIntoWeeks(dates: string[]): WeekGroup[] {
  const groups = new Map<string, string[]>();
  for (const date of [...new Set(dates)].sort()) {
    const key = weekStartOf(date);
    const list = groups.get(key);
    if (list) list.push(date);
    else groups.set(key, [date]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([startDate, list], index) => ({
      weekNumber: index + 1,
      startDate,
      endDate: addDays(startDate, 6),
      dates: list.sort(),
    }));
}

export interface PlanInput extends CalendarInput {
  /** Template unit capacity, if a template is chosen. */
  maxUnits?: number;
}

export function computePlan(input: PlanInput, config: PricingConfig = defaultPricing()): Plan {
  const calendar = buildCalendar(input);
  const groups = groupIntoWeeks(calendar.workingDates);
  const warnings: string[] = [];
  const weeks = groups.length;
  if (weeks === 0) warnings.push('No working days were found in this date range. Check your dates and days off.');
  if (weeks > 52) warnings.push('That is a very long placement. Only the first 52 weeks will be used.');
  const limitedGroups = groups.slice(0, 52);
  const effectiveWeeks = limitedGroups.length;
  if (input.maxUnits && effectiveWeeks > input.maxUnits) {
    warnings.push(
      `This logbook has room for ${input.maxUnits} weeks, so the last ${effectiveWeeks - input.maxUnits} week(s) will not be filled.`,
    );
  }
  return {
    weeks: effectiveWeeks,
    workingDates: limitedGroups.flatMap((g) => g.dates),
    groups: limitedGroups,
    sizeTier: creditsForWeeks(Math.max(1, effectiveWeeks), config.sizeTiers),
    cost: creditsForWeeks(Math.max(1, effectiveWeeks), config.sizeTiers),
    warnings,
  };
}
