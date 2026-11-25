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
      entry: 'I checked the pump alignment and logged the pressure reading before the shift ended.',
      basedOn: ['T1'],
    };
  });
  return {
    weekNumber: number,
    startDate: days[0]!.date,
    endDate: days[4]!.date,
    workingDates: days.map((day) => day.date),
    days,
    weeklySummary: 'A week of alignment checks.',
    status: 'done',
    regenCount: 0,
    flags: [],
  };
}

const intake = {
  company: 'ZICS',
  unit: 'Line 2',
  startDate: '2027-01-04',
  endDate: '2027-01-15',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  extraDaysOff: [],
  tasks: [{ id: 'T1', text: 'Checked the pump' }],
  tools: ['Dial gauge'],
  skills: ['Alignment'],
  detail: 'standard' as const,
};

describe('typeface choice', () => {
  it('sets the same document in any of the three faces', async () => {
    const fontBytes = await loadFontBytes();
    const sizes: number[] = [];
    for (const fontFamily of ['sans', 'serif', 'mono'] as const) {
      const { bytes, pages } = await buildLogbookDocument(
        {
          profile: { ...genericProfile(), weeks: 2, monthlyEvery: 0 },
          weeks: [week(1), week(2)],
          intake,
          studentDetails: { fullName: 'Ada Student' },
          title: 'Typeface test',
          programme: 'SIWES',
          fontFamily,
        },
        fontBytes,
      );
      const pdf = await PDFDocument.load(bytes);
      expect(pdf.getPageCount()).toBe(pages);
      expect(pdf.getPageCount()).toBe(4); // cover + 2 weeks + certification
      sizes.push(bytes.byteLength);
    }
    // A standard face embeds less than the Noto subset, so the files cannot all be the same size.
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
});
