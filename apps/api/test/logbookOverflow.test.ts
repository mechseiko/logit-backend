import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { WeekRecord } from '@logit/shared';
import { buildLogbookDocument } from '../src/services/pdf/logbookDoc.js';
import { loadFontBytes } from '../src/services/fonts.js';
import { genericProfile } from './genericProfile.js';

const long = (seed: number) =>
  `I spent the day on the ${seed} line, checking the drive coupling, greasing the bearings, recording the vibration reading and cleaning the area before the shift ended. `.repeat(6);

function week(number: number, entry: string): WeekRecord {
  const start = new Date('2027-01-04T00:00:00Z');
  start.setUTCDate(start.getUTCDate() + (number - 1) * 7);
  const days = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      dayName: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][index]!,
      entry,
      basedOn: ['T1'],
    };
  });
  return {
    weekNumber: number,
    startDate: days[0]!.date,
    endDate: days[5]!.date,
    workingDates: days.map((day) => day.date),
    days,
    weeklySummary: 'A long week on the line, with the readings logged and the area left clean.',
    status: 'done',
    regenCount: 0,
    flags: [],
  };
}

const intake = {
  company: 'ZICS',
  unit: 'Line 2',
  startDate: '2027-01-04',
  endDate: '2027-02-12',
  workingDays: [1, 2, 3, 4, 5, 6],
  holidays: [],
  extraDaysOff: [],
  tasks: [{ id: 'T1', text: 'Ran the line' }],
  tools: ['Vibration meter'],
  skills: ['Alignment'],
  detail: 'detailed' as const,
};

describe('long days never fall off the page', () => {
  it('continues a six-day week across pages instead of drawing past the margin', async () => {
    const fontBytes = await loadFontBytes();
    const profile = { ...genericProfile(), daysPerWeek: 6 as const, weeks: 1, monthlyEvery: 0 };
    const { pages, bytes } = await buildLogbookDocument(
      {
        profile,
        weeks: [week(1, long(1))],
        intake,
        studentDetails: { fullName: 'Ada Student' },
        title: 'Long week',
        programme: 'SIWES',
      },
      fontBytes,
    );

    // cover + at least two pages for the same week + certification
    expect(pages).toBeGreaterThanOrEqual(4);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(pages);
  });
});
