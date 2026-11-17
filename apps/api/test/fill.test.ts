import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import type { Template, WeekRecord } from '@logit/shared';
import { buildCopySheet } from '../src/services/copysheet.js';
import { fillTemplate, lineAnchor, placeRect } from '../src/services/fill.js';
import { loadFontBytes } from '../src/services/fonts.js';
import { makeLogbookPdf } from './fixtures.js';

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;

function makeWeek(weekNumber: number, startDate: string, entries: string[]): WeekRecord {
  const start = new Date(`${startDate}T00:00:00Z`);
  const days = entries.map((entry, index) => {
    const date = new Date(start);
    date.setUTCDate(start.getUTCDate() + index);
    return {
      date: date.toISOString().slice(0, 10),
      dayName: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'][index] ?? 'Day',
      entry,
      basedOn: ['T1'],
    };
  });
  return {
    weekNumber,
    startDate,
    endDate: days[days.length - 1]?.date ?? startDate,
    workingDates: days.map((day) => day.date),
    days,
    weeklySummary: 'A short summary of the week.',
    status: 'done',
    regenCount: 0,
    flags: [],
  };
}

const template: Template = {
  id: 'tpl_fill',
  name: 'Fill test',
  schoolIds: [],
  programmes: ['SIWES'],
  pageSizeKey: '595x842',
  fingerprint: { pageCount: 3, dhash: [] },
  unit: {
    pagesPerUnit: 1,
    firstEntryPage: 1,
    maxUnits: 2,
    daysPerUnit: 5,
    fields: Array.from({ length: 5 }, (_, index) => ({
      key: `activity_${index}`,
      type: 'daily_activity' as const,
      page: 0,
      rect: { x: 0.3, y: 0.2 + index * 0.13, w: 0.6, h: 0.1 },
      dayIndex: index,
      fontSize: { min: 6.5, max: 9 },
      fill: true,
    })).concat([
      {
        key: 'signature',
        type: 'signature' as const,
        page: 0,
        rect: { x: 0.1, y: 0.9, w: 0.3, h: 0.04 },
        fontSize: { min: 8, max: 10 },
        fill: false,
      },
    ]),
  },
  staticFields: [
    {
      key: 'full_name',
      type: 'student_detail',
      page: 0,
      rect: { x: 0.2, y: 0.3, w: 0.6, h: 0.04 },
      detailKey: 'fullName',
      fontSize: { min: 8, max: 12 },
      fill: true,
    },
  ],
  status: 'published',
  version: 1,
};

const intake = {
  company: 'Zenith Bank',
  unit: 'IT Support',
  startDate: '2026-02-02',
  endDate: '2026-02-13',
  workingDays: [1, 2, 3, 4, 5],
  holidays: [],
  extraDaysOff: [],
  tasks: [{ id: 'T1', text: 'Cable termination' }],
  tools: ['crimping tool'],
  skills: ['fault finding'],
  detail: 'standard' as const,
};

const weeks = [
  makeWeek(1, '2026-02-02', [
    'I terminated network cables with the crimping tool.',
    'I tested the cables and labelled the good ones.',
    'I documented the faults reported by staff.',
    'I replaced two faulty patch cords.',
    'I tidied the rack and closed the week.',
  ]),
  makeWeek(2, '2026-02-09', [
    'I continued cable termination on the second floor.',
    'I tested the new cables before handing them over.',
    'I updated the fault register.',
    'I helped a colleague trace a broken link.',
    'I reviewed the week and reported progress.',
  ]),
];

describe('placeRect', () => {
  const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };

  it('maps unrotated boxes from top-left to PDF coordinates', () => {
    const placement = placeRect(rect, PAGE_WIDTH, PAGE_HEIGHT, 0);
    expect(placement.x).toBeCloseTo(0.1 * PAGE_WIDTH, 5);
    expect(placement.y).toBeCloseTo((1 - 0.2 - 0.1) * PAGE_HEIGHT, 5);
    expect(placement.width).toBeCloseTo(0.3 * PAGE_WIDTH, 5);
    expect(placement.height).toBeCloseTo(0.1 * PAGE_HEIGHT, 5);
    expect(placement.rotate).toBe(0);
  });

  it('swaps dimensions for 90 and 270 degree pages', () => {
    for (const rotation of [90, 270]) {
      const placement = placeRect(rect, PAGE_WIDTH, PAGE_HEIGHT, rotation);
      expect(placement.width).toBeCloseTo(0.3 * PAGE_HEIGHT, 5);
      expect(placement.height).toBeCloseTo(0.1 * PAGE_WIDTH, 5);
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.x).toBeLessThanOrEqual(PAGE_WIDTH);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeLessThanOrEqual(PAGE_HEIGHT);
    }
  });

  it('keeps every corner inside the page for all rotations', () => {
    for (const rotation of [0, 90, 180, 270]) {
      const placement = placeRect(rect, PAGE_WIDTH, PAGE_HEIGHT, rotation);
      const anchor = lineAnchor(placement, 8, 1.15, 0);
      expect(anchor.x).toBeGreaterThanOrEqual(-1);
      expect(anchor.x).toBeLessThanOrEqual(PAGE_WIDTH + 1);
      expect(anchor.y).toBeGreaterThanOrEqual(-1);
      expect(anchor.y).toBeLessThanOrEqual(PAGE_HEIGHT + 1);
    }
  });
});

describe('fillTemplate', () => {
  it('fills each week on the right page and reports placements', async () => {
    const pdf = await makeLogbookPdf({ pages: 3 });
    const font = await loadFontBytes();
    const result = await fillTemplate(
      pdf,
      { template, weeks, intake, studentDetails: { fullName: 'Ada Student' }, programme: 'SIWES' },
      font,
    );

    expect(result.pages).toBe(3);
    expect(result.overflow).toEqual([]);
    expect(result.filledFields).toBe(11); // 10 daily activity boxes + 1 static name

    const weekOne = result.placements.filter((placement) => placement.week === 1 && placement.field !== 'full_name');
    const weekTwo = result.placements.filter((placement) => placement.week === 2);
    expect(weekOne).toHaveLength(5);
    expect(weekTwo).toHaveLength(5);
    expect(new Set(weekOne.map((placement) => placement.page))).toEqual(new Set([1]));
    expect(new Set(weekTwo.map((placement) => placement.page))).toEqual(new Set([2]));

    for (const placement of result.placements) {
      expect(placement.x).toBeGreaterThanOrEqual(0);
      expect(placement.y).toBeGreaterThanOrEqual(0);
      expect(placement.x + placement.width).toBeLessThanOrEqual(PAGE_WIDTH + 1);
      expect(placement.y + placement.height).toBeLessThanOrEqual(PAGE_HEIGHT + 1);
      expect(placement.fontSize).toBeGreaterThanOrEqual(6.5);
      const max = placement.field === 'full_name' ? 12 : 9;
      expect(placement.fontSize).toBeLessThanOrEqual(max);
      expect(placement.truncated).toBe(false);
    }

    // Signature boxes are never filled.
    expect(result.placements.some((placement) => placement.field === 'signature')).toBe(false);

    const output = await PDFDocument.load(result.bytes);
    expect(output.getPageCount()).toBe(3);
  });

  it('shortens overflowing text then flags truncation', async () => {
    const pdf = await makeLogbookPdf({ pages: 2, withText: false });
    const font = await loadFontBytes();
    const tiny: Template = {
      ...template,
      unit: {
        ...template.unit,
        maxUnits: 1,
        fields: [
          {
            key: 'activity_0',
            type: 'daily_activity',
            page: 0,
            rect: { x: 0.3, y: 0.3, w: 0.2, h: 0.02 },
            dayIndex: 0,
            fontSize: { min: 8, max: 9 },
            fill: true,
          },
        ],
      },
      staticFields: [],
    };

    let shortenCalls = 0;
    const shortened = await fillTemplate(
      pdf,
      {
        template: tiny,
        weeks: [makeWeek(1, '2026-02-02', ['word '.repeat(80)])],
        intake,
        studentDetails: {},
        programme: 'SIWES',
        shorten: async (text, maxChars) => {
          shortenCalls += 1;
          return text.slice(0, maxChars);
        },
      },
      font,
    );
    expect(shortenCalls).toBeGreaterThan(0);
    expect(shortened.placements).toHaveLength(1);

    // Without a shortener, the text is truncated and the overflow is reported.
    const truncated = await fillTemplate(
      pdf,
      {
        template: tiny,
        weeks: [makeWeek(1, '2026-02-02', ['word '.repeat(80)])],
        intake,
        studentDetails: {},
        programme: 'SIWES',
      },
      font,
    );
    expect(truncated.overflow.length).toBeGreaterThan(0);
    expect(truncated.placements[0]?.truncated).toBe(true);
  });

  it('watermarks previews', async () => {
    const pdf = await makeLogbookPdf({ pages: 2, withText: false });
    const font = await loadFontBytes();
    const plain = await fillTemplate(
      pdf,
      { template, weeks: weeks.slice(0, 1), intake, studentDetails: {}, programme: 'SIWES' },
      font,
    );
    const marked = await fillTemplate(
      pdf,
      {
        template,
        weeks: weeks.slice(0, 1),
        intake,
        studentDetails: {},
        programme: 'SIWES',
        watermark: true,
      },
      font,
    );
    expect(marked.bytes.byteLength).toBeGreaterThan(plain.bytes.byteLength);
  });
});

describe('copy sheet', () => {
  it('creates one page per week with the entries', async () => {
    const font = await loadFontBytes();
    const bytes = await buildCopySheet(
      { weeks, intake, title: 'My IT logbook', programme: 'SIWES' },
      font,
    );
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(2);
  });

  it('watermarks preview copy sheets', async () => {
    const font = await loadFontBytes();
    const plain = await buildCopySheet({ weeks, intake, title: 'x', programme: 'SIWES' }, font);
    const marked = await buildCopySheet(
      { weeks, intake, title: 'x', programme: 'SIWES', watermark: true },
      font,
    );
    expect(marked.byteLength).toBeGreaterThan(plain.byteLength);
  });
});
