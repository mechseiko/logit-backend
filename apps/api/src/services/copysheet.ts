import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, rgb } from 'pdf-lib';
import { formatDate, weekdayName, type IntakeAnswers, type WeekRecord } from '@logit/shared';
import { A4 } from './pdf/build.js';
import { drawWatermark } from './fill.js';

export interface CopySheetContext {
  weeks: WeekRecord[];
  intake: IntakeAnswers;
  title: string;
  programme: string;
  watermark?: boolean;
}

const MARGIN = 42;

/**
 * Characters that actually fit on one ruled line. 0.5em is a safe average advance for the Noto
 * Sans subset; wrapping by a larger count would draw text past the right margin.
 */
export function fitCharsPerLine(
  requestedChars: number,
  lineWidthPt: number,
  fontSize: number,
): number {
  const byWidth = Math.floor(lineWidthPt / (fontSize * 0.5));
  return Math.max(20, Math.min(requestedChars, byWidth));
}

function wrapByChars(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let current = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word;
      if (candidate.length <= maxChars) current = candidate;
      else {
        if (current) lines.push(current);
        current = word;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

function drawHeader(page: PDFPage, font: PDFFont, context: CopySheetContext): number {
  const { width, height } = page.getSize();
  page.drawText('LOGIT copy sheet', {
    x: MARGIN,
    y: height - MARGIN - 10,
    size: 9,
    font,
    color: rgb(0.42, 0.45, 0.5),
  });
  page.drawText(context.title || 'Industrial training logbook', {
    x: MARGIN,
    y: height - MARGIN - 32,
    size: 15,
    font,
    color: rgb(0.1, 0.11, 0.13),
  });
  const subtitle = [
    context.programme,
    context.intake.company,
    context.intake.unit ? `Unit: ${context.intake.unit}` : '',
  ]
    .filter(Boolean)
    .join('  ·  ');
  page.drawText(subtitle, {
    x: MARGIN,
    y: height - MARGIN - 48,
    size: 9,
    font,
    color: rgb(0.35, 0.38, 0.43),
  });
  page.drawLine({
    start: { x: MARGIN, y: height - MARGIN - 58 },
    end: { x: width - MARGIN, y: height - MARGIN - 58 },
    thickness: 0.8,
    color: rgb(0.8, 0.82, 0.85),
  });
  return height - MARGIN - 74;
}

function drawFooter(page: PDFPage, font: PDFFont, pageNumber: number, total: number): void {
  const { width } = page.getSize();
  page.drawText(`Page ${pageNumber} of ${total}`, {
    x: width - MARGIN - 50,
    y: 24,
    size: 8,
    font,
    color: rgb(0.55, 0.58, 0.62),
  });
  page.drawText('Written by the student from their own experience. Do not copy blindly.', {
    x: MARGIN,
    y: 24,
    size: 7.5,
    font,
    color: rgb(0.6, 0.62, 0.66),
  });
}

/**
 * Day-by-day entries sized to the student's logbook lines, for layouts we do not support yet.
 * One week per page, each day box ruled into `linesPerDay` writing lines.
 */
export async function buildCopySheet(context: CopySheetContext, fontBytes: Buffer): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const linesPerDay = Math.min(20, Math.max(3, context.intake.linesPerDay ?? 5));
  const requestedCharsPerLine = Math.min(120, Math.max(40, context.intake.charsPerLine ?? 70));
  const pages: PDFPage[] = [];

  for (const week of context.weeks) {
    let page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    const { width } = page.getSize();
    let cursor = drawHeader(page, font, context);

    page.drawText(
      `Week ${week.weekNumber}   ${formatDate(week.startDate)} – ${formatDate(week.endDate)}`,
      { x: MARGIN, y: cursor, size: 11, font, color: rgb(0.1, 0.11, 0.13) },
    );
    cursor -= 16;

    const dateWidth = 58;
    const dayWidth = 56;
    const entryX = MARGIN + dateWidth + dayWidth + 8;
    const entryWidth = width - MARGIN - entryX;
    const lineGap = 12.5;
    const boxHeight = linesPerDay * lineGap + 8;

    for (const day of week.days) {
      if (cursor - boxHeight < MARGIN + 24) {
        // Start a fresh page when the week is unusually long.
        page = pdf.addPage([A4.width, A4.height]);
        pages.push(page);
        cursor = drawHeader(page, font, context);
      }
      const top = cursor;
      page.drawText(formatDate(day.date), {
        x: MARGIN,
        y: top - 10,
        size: 8.5,
        font,
        color: rgb(0.15, 0.16, 0.19),
      });
      page.drawText(weekdayName(day.date), {
        x: MARGIN + dateWidth,
        y: top - 10,
        size: 8.5,
        font,
        color: rgb(0.35, 0.38, 0.43),
      });

      // Wrap to what the entry column can really hold at each size, never to the raw request.
      let fontSize = 9;
      let charsPerLine = fitCharsPerLine(requestedCharsPerLine, entryWidth, fontSize);
      let lines = wrapByChars(day.entry, charsPerLine);
      if (lines.length > linesPerDay) {
        fontSize = 7.5;
        charsPerLine = fitCharsPerLine(requestedCharsPerLine, entryWidth, fontSize);
        lines = wrapByChars(day.entry, charsPerLine);
      }
      const maxLines = Math.min(linesPerDay, lines.length);
      for (let i = 0; i < maxLines; i += 1) {
        const text = i === maxLines - 1 && lines.length > linesPerDay ? `${lines[i]}…` : lines[i]!;
        page.drawText(text, {
          x: entryX,
          y: top - 10 - i * lineGap,
          size: fontSize,
          font,
          color: rgb(0.1, 0.11, 0.13),
        });
      }

      for (let i = 0; i < linesPerDay; i += 1) {
        const y = top - 15 - i * lineGap;
        page.drawLine({
          start: { x: entryX, y },
          end: { x: entryX + entryWidth, y },
          thickness: 0.4,
          color: rgb(0.86, 0.87, 0.89),
        });
      }
      page.drawLine({
        start: { x: MARGIN, y: top + 6 },
        end: { x: width - MARGIN, y: top + 6 },
        thickness: 0.6,
        color: rgb(0.8, 0.82, 0.85),
      });
      cursor = top - boxHeight - 10;
    }

    if (week.weeklySummary) {
      const summaryLines = wrapByChars(`Weekly summary: ${week.weeklySummary}`, 105).slice(0, 3);
      summaryLines.forEach((line, index) => {
        page.drawText(line, {
          x: MARGIN,
          y: cursor - index * 11,
          size: 8,
          font,
          color: rgb(0.3, 0.33, 0.38),
        });
      });
    }
  }

  if (pages.length === 0) {
    const page = pdf.addPage([A4.width, A4.height]);
    pages.push(page);
    drawHeader(page, font, context);
  }

  if (context.watermark) for (const page of pages) drawWatermark(page, font);
  pages.forEach((page, index) => drawFooter(page, font, index + 1, pages.length));

  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}
