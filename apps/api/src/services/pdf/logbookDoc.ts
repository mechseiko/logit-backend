import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, degrees, type PDFFont, type PDFPage, rgb } from 'pdf-lib';
import {
  formatDate,
  weekdayName,
  type FontFamily,
  type IntakeAnswers,
  type LogbookProfile,
  type StudentDetails,
  type WeekRecord,
} from '@logit/shared';
import { A4 } from './build.js';

/**
 * Builds the finished logbook: a structured, printable A4 document written from the student's own
 * account of the placement.
 *
 * This replaces the old approach of drawing text into a scanned copy of the student's book. There are
 * no templates, no fingerprints and no boxes: the profile says how the week is shaped, and the
 * builder lays out a clean document with a cover page, one week per page, a monthly summary, and a
 * page the supervisor signs. Signatures, stamps and remarks are always left blank.
 */

const MARGIN = 56;
const INK = rgb(0.08, 0.1, 0.09);
const MUTED = rgb(0.36, 0.4, 0.38);
const RULE = rgb(0.78, 0.8, 0.77);
const BRAND = rgb(0.04, 0.42, 0.3);
const WATER = rgb(0.85, 0.87, 0.84);

export interface LogbookDocContext {
  profile: LogbookProfile;
  weeks: WeekRecord[];
  intake: IntakeAnswers;
  studentDetails: StudentDetails;
  title: string;
  programme: string;
  watermark?: boolean;
  /** Typeface for the whole document. Defaults to the embedded Noto Sans. */
  fontFamily?: FontFamily;
}

/**
 * The embedded subset font does not carry every Unicode punctuation mark, and a missing glyph prints
 * as a blank box. Everything drawn into the document goes through this first.
 */
export function clean(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201b]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/\u00b7/g, '|')
    .replace(/\u00a0/g, ' ');
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of clean(text).split(/\n+/)) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) <= width) {
        current = next;
        continue;
      }
      if (current) lines.push(current);
      // A single word wider than the column: break it by characters rather than overflow the page.
      if (font.widthOfTextAtSize(word, size) > width) {
        let chunk = '';
        for (const character of word) {
          if (font.widthOfTextAtSize(chunk + character, size) > width) {
            lines.push(chunk);
            chunk = character;
          } else {
            chunk += character;
          }
        }
        current = chunk;
      } else {
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function label(page: PDFPage, font: PDFFont, text: string, x: number, y: number, size = 8) {
  page.drawText(clean(text).toUpperCase(), {
    x,
    y,
    size,
    font,
    color: MUTED,
  });
}

function paragraph(
  page: PDFPage,
  font: PDFFont,
  text: string,
  options: { x: number; y: number; width: number; size?: number; color?: typeof INK; gap?: number },
): number {
  const size = options.size ?? 10;
  const gap = options.gap ?? 4;
  const lines = wrap(text, font, size, options.width);
  let y = options.y;
  for (const line of lines) {
    page.drawText(line, { x: options.x, y, size, font, color: options.color ?? INK });
    y -= size + gap;
  }
  return y;
}

function watermark(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize();
  page.drawText('LOGIT PREVIEW', {
    x: width / 2 - 150,
    y: height / 2,
    size: 48,
    font,
    color: WATER,
    rotate: degrees(32),
  });
}

function footer(page: PDFPage, font: PDFFont, pageNumber: number, total: number): void {
  const { width } = page.getSize();
  page.drawText('Written by the student from their own placement. Check every entry before you submit it.', {
    x: MARGIN,
    y: 28,
    size: 7,
    font,
    color: MUTED,
  });
  page.drawText(`${pageNumber} / ${total}`, {
    x: width - MARGIN - 28,
    y: 28,
    size: 8,
    font,
    color: MUTED,
  });
}

function cover(pdf: PDFDocument, font: PDFFont, context: LogbookDocContext): PDFPage {
  const page = pdf.addPage([A4.width, A4.height]);
  const { width, height } = page.getSize();
  const details = context.studentDetails ?? {};

  page.drawRectangle({ x: 0, y: height - 8, width, height: 8, color: BRAND });
  label(page, font, context.programme + ' logbook', MARGIN, height - 90, 9);
  paragraph(page, font, context.profile.title, {
    x: MARGIN,
    y: height - 130,
    width: width - MARGIN * 2,
    size: 26,
    gap: 8,
  });
  page.drawLine({
    start: { x: MARGIN, y: height - 232 },
    end: { x: width - MARGIN, y: height - 232 },
    thickness: 0.8,
    color: RULE,
  });

  const rows: Array<[string, string]> = [
    ['Student', details.fullName || '-'],
    ['Matric number', details.matricNo || '-'],
    ['School', details.school || '-'],
    ['Department', details.department || '-'],
    ['Level', details.level || '-'],
    ['Company', context.intake.company],
    ['Unit / section', context.intake.unit || '-'],
    ['Placement', `${formatDate(context.intake.startDate)} to ${formatDate(context.intake.endDate)}`],
    ['Weeks written', String(context.weeks.length)],
  ];
  let y = height - 268;
  for (const [key, value] of rows) {
    label(page, font, key, MARGIN, y, 7.5);
    page.drawText(clean(value), { x: MARGIN + 120, y, size: 11, font, color: INK });
    y -= 26;
  }

  y -= 12;
  page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.6, color: RULE });
  y -= 22;
  paragraph(
    page,
    font,
    'This document records the work described by the student. Signatures, stamps and supervisor remarks are left blank for the people who must give them in person. Handwritten entries in the official school book remain the student’s own.',
    { x: MARGIN, y, width: width - MARGIN * 2, size: 9, color: MUTED, gap: 5 },
  );

  return page;
}

/**
 * One week, drawn day by day. A long week is never clipped and never squeezed off the page: when the
 * next day cannot fit, the week continues on a fresh page with the same columns.
 */
function weekPage(
  pdf: PDFDocument,
  font: PDFFont,
  context: LogbookDocContext,
  week: WeekRecord,
): PDFPage[] {
  const pages: PDFPage[] = [];
  let page = pdf.addPage([A4.width, A4.height]);
  const { width, height } = page.getSize();
  const dateX = MARGIN;
  const dayX = MARGIN + 62;
  const entryX = MARGIN + 118;
  const entryWidth = width - MARGIN - entryX;
  const bottomLimit = MARGIN + 40;
  let continued = false;

  const header = (target: PDFPage) => {
    label(target, font, 'Week ' + week.weekNumber + (continued ? ' (continued)' : ''), MARGIN, height - 72, 8);
    target.drawText(`${formatDate(week.startDate)}  -  ${formatDate(week.endDate)}`, {
      x: MARGIN,
      y: height - 96,
      size: 15,
      font,
      color: INK,
    });
    target.drawText(clean(context.profile.labels.weekly), {
      x: width - MARGIN - font.widthOfTextAtSize(clean(context.profile.labels.weekly), 8),
      y: height - 72,
      size: 8,
      font,
      color: MUTED,
    });
    target.drawLine({
      start: { x: MARGIN, y: height - 112 },
      end: { x: width - MARGIN, y: height - 112 },
      thickness: 0.8,
      color: RULE,
    });
    label(target, font, 'Date', dateX, height - 130, 7);
    label(target, font, 'Day', dayX, height - 130, 7);
    label(target, font, 'Activities', entryX, height - 130, 7);
  };

  header(page);
  pages.push(page);
  let y = height - 146;

  for (const day of week.days) {
    let size = 9.5;
    let lines = wrap(day.entry, font, size, entryWidth);
    if (lines.length > 8) {
      size = 8;
      lines = wrap(day.entry, font, size, entryWidth);
    }
    const rowHeight = Math.max(46, lines.length * (size + 3.5) + 14);

    if (y - rowHeight < bottomLimit) {
      continued = true;
      page = pdf.addPage([A4.width, A4.height]);
      pages.push(page);
      header(page);
      y = height - 146;
    }

    page.drawText(formatDate(day.date), { x: dateX, y: y - 10, size: 9, font, color: INK });
    page.drawText(weekdayName(day.date), { x: dayX, y: y - 10, size: 9, font, color: MUTED });
    lines.forEach((line, index) => {
      page.drawText(line, {
        x: entryX,
        y: y - 10 - index * (size + 3.5),
        size,
        font,
        color: INK,
      });
    });
    y -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: width - MARGIN, y },
      thickness: 0.4,
      color: RULE,
    });
  }

  if (week.weeklySummary) {
    const summaryLines = wrap(week.weeklySummary, font, 9, width - MARGIN * 2);
    const needed = 18 + 14 + summaryLines.length * 13;
    if (y - needed < bottomLimit) {
      continued = true;
      page = pdf.addPage([A4.width, A4.height]);
      pages.push(page);
      header(page);
      y = height - 146;
    }
    y -= 18;
    label(page, font, context.profile.labels.summary, MARGIN, y, 7);
    y -= 14;
    paragraph(page, font, week.weeklySummary, {
      x: MARGIN,
      y,
      width: width - MARGIN * 2,
      size: 9,
      color: MUTED,
      gap: 4,
    });
  }

  return pages;
}

function monthlyPage(
  pdf: PDFDocument,
  font: PDFFont,
  context: LogbookDocContext,
  weeks: WeekRecord[],
  index: number,
): PDFPage {
  const page = pdf.addPage([A4.width, A4.height]);
  const { width, height } = page.getSize();
  const first = weeks[0]!;
  const last = weeks[weeks.length - 1]!;

  label(page, font, context.profile.labels.monthly + '  ' + (index + 1), MARGIN, height - 72, 8);
  page.drawText(`${formatDate(first.startDate)}  -  ${formatDate(last.endDate)}`, {
    x: MARGIN,
    y: height - 96,
    size: 15,
    font,
    color: INK,
  });
  page.drawLine({
    start: { x: MARGIN, y: height - 112 },
    end: { x: width - MARGIN, y: height - 112 },
    thickness: 0.8,
    color: RULE,
  });

  let y = height - 140;
  for (const week of weeks) {
    const summary = week.weeklySummary || week.days.map((day) => day.entry).join(' ');
    label(page, font, 'Week ' + week.weekNumber, MARGIN, y, 7);
    y -= 14;
    y = paragraph(page, font, summary, {
      x: MARGIN,
      y,
      width: width - MARGIN * 2,
      size: 9.5,
      gap: 4,
    });
    y -= 12;
  }
  return page;
}

function supervisorPage(pdf: PDFDocument, font: PDFFont, context: LogbookDocContext): PDFPage {
  const page = pdf.addPage([A4.width, A4.height]);
  const { width, height } = page.getSize();

  label(page, font, 'Certification', MARGIN, height - 72, 8);
  page.drawText('To be completed by hand', {
    x: MARGIN,
    y: height - 96,
    size: 15,
    font,
    color: INK,
  });
  page.drawLine({
    start: { x: MARGIN, y: height - 112 },
    end: { x: width - MARGIN, y: height - 112 },
    thickness: 0.8,
    color: RULE,
  });

  paragraph(
    page,
    font,
    `I confirm that this record describes work carried out at ${context.intake.company}${
      context.intake.unit ? `, ${context.intake.unit}` : ''
    }, from ${formatDate(context.intake.startDate)} to ${formatDate(context.intake.endDate)}.`,
    { x: MARGIN, y: height - 142, width: width - MARGIN * 2, size: 10, color: INK, gap: 5 },
  );

  let y = height - 232;
  for (const [title, lines] of [
    [context.profile.labels.supervisor, 3],
    ['Name of industry-based supervisor', 1],
    ['Signature and date', 1],
    ['Company stamp', 2],
    ['Student signature and date', 1],
  ] as Array<[string, number]>) {
    label(page, font, title, MARGIN, y, 7);
    let lineY = y - 18;
    for (let i = 0; i < lines; i += 1) {
      page.drawLine({
        start: { x: MARGIN, y: lineY },
        end: { x: width - MARGIN, y: lineY },
        thickness: 0.4,
        color: RULE,
      });
      lineY -= 20;
    }
    y = lineY - 22;
  }

  return page;
}

export async function buildLogbookDocument(
  context: LogbookDocContext,
  fontBytes: Buffer,
): Promise<{ bytes: Buffer; pages: number }> {
  const pdf = await PDFDocument.create();
  const family: FontFamily = context.fontFamily ?? 'sans';
  // Times and Courier are standard PDF faces, so a traditional report needs no extra binary.
  let font: PDFFont;
  if (family === 'serif') {
    font = await pdf.embedFont(StandardFonts.TimesRoman);
  } else if (family === 'mono') {
    font = await pdf.embedFont(StandardFonts.Courier);
  } else {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fontBytes, { subset: true });
  }

  pdf.setTitle(`${context.title} - ${context.studentDetails?.fullName ?? 'Logbook'}`);
  pdf.setCreator('Logit');
  pdf.setProducer('Logit');

  const pages: PDFPage[] = [cover(pdf, font, context)];

  const weeks = context.weeks.slice().sort((a, b) => a.weekNumber - b.weekNumber);
  const monthlyEvery = context.profile.monthlyEvery ?? 0;
  let block: WeekRecord[] = [];
  let blockIndex = 0;

  for (const week of weeks) {
    pages.push(...weekPage(pdf, font, context, week));
    if (monthlyEvery > 0) {
      block.push(week);
      if (block.length === monthlyEvery) {
        pages.push(monthlyPage(pdf, font, context, block, blockIndex));
        blockIndex += 1;
        block = [];
      }
    }
  }
  // A closing partial month still deserves its summary.
  if (monthlyEvery > 0 && block.length > 1) {
    pages.push(monthlyPage(pdf, font, context, block, blockIndex));
  }

  pages.push(supervisorPage(pdf, font, context));

  if (context.watermark) for (const page of pages) watermark(page, font);
  pages.forEach((page, index) => footer(page, font, index + 1, pages.length));

  pdf.setKeywords(['logbook', context.programme, context.profile.name]);
  const bytes = Buffer.from(await pdf.save({ useObjectStreams: true }));
  return { bytes, pages: pdf.getPageCount() };
}
