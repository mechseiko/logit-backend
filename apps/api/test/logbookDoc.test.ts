import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { WeekRecord } from '@logit/shared';
import { buildLogbookDocument } from '../src/services/pdf/logbookDoc.js';
import { loadFontBytes } from '../src/services/fonts.js';
import { genericProfile } from './genericProfile.js';

function week(number: number): WeekRecord {
  const start = new Date('2027-01-04T00:00:00Z');
  start.setUTCDate(start.getUTCDate() + (number - 1) * 7);
  const days = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      dayName: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][index]!,
      entry: `I worked on the feed pump and recorded the discharge pressure at ${4 + index} bar.`,
      basedOn: ['T1'],
    };
  });
  return {
    weekNumber: number,
    startDate: days[0]!.date,
    endDate: days[4]!.date,
    workingDates: days.map((day) => day.date),
    days,
    weeklySummary: 'A week of pump work, alignment checks and a pressure log.',
    status: 'done',
    regenCount: 0,
    flags: [],
  };
}

const intake = {
  company: 'ZICS',
  unit: 'Fabrication',
  startDate: '2027-01-04',
  endDate: '2027-03-26',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  extraDaysOff: [],
  tasks: [{ id: 'T1', text: 'Serviced the auxiliary feed pump' }],
  tools: ['Dial gauge'],
  skills: ['Pump alignment'],
  detail: 'standard' as const,
};

describe('logbook document', () => {
  it('builds a cover, one page per week, a monthly summary and a signature page', async () => {
    const fontBytes = await loadFontBytes();
    const profile = { ...genericProfile(), weeks: 8, monthlyEvery: 4 };
    const weeks = Array.from({ length: 8 }, (_, index) => week(index + 1));
    const { bytes, pages } = await buildLogbookDocument(
      {
        profile,
        weeks,
        intake,
        studentDetails: { fullName: 'Ada Student', matricNo: 'MEE/2022/123', school: 'OAU' },
        title: 'My logbook',
        programme: 'SIWES',
      },
      fontBytes,
    );

    // cover + 8 weeks + 2 monthly pages + certification
    expect(pages).toBe(12);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(12);
    const { width, height } = pdf.getPages()[0]!.getSize();
    expect(Math.round(width)).toBe(595);
    expect(Math.round(height)).toBe(842);
    expect(bytes.byteLength).toBeGreaterThan(5000);
  });

  it('watermarks a preview without changing the structure', async () => {
    const fontBytes = await loadFontBytes();
    const profile = { ...genericProfile(), weeks: 4, monthlyEvery: 0 };
    const weeks = Array.from({ length: 4 }, (_, index) => week(index + 1));
    const { pages } = await buildLogbookDocument(
      {
        profile,
        weeks,
        intake,
        studentDetails: { fullName: 'Ada Student' },
        title: 'My logbook',
        programme: 'SIWES',
        watermark: true,
      },
      fontBytes,
    );
    expect(pages).toBe(6); // cover + 4 weeks + certification
  });
});
