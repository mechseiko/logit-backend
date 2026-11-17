import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, PDFFont, PDFPage, degrees, rgb } from 'pdf-lib';
import {
  approximateCharsPerLine,
  fitText,
  weekdayName,
  type IntakeAnswers,
  type Rect,
  type StudentDetails,
  type Template,
  type TemplateField,
  type WeekRecord,
} from '@logit/shared';
import { isFieldFillable } from '@logit/shared';

export interface Placement {
  x: number;
  y: number;
  rotate: number;
  width: number;
  height: number;
}

/**
 * Converts a normalised (top-left origin) rectangle measured on the *displayed* page
 * into PDF user-space coordinates, accounting for /Rotate. This is the one place
 * rotation is handled; everything else works in displayed coordinates.
 */
export function placeRect(rect: Rect, pageWidth: number, pageHeight: number, rotation: number): Placement {
  const normalised = ((rotation % 360) + 360) % 360;
  switch (normalised) {
    case 90: {
      const displayedWidth = pageHeight;
      const displayedHeight = pageWidth;
      return {
        x: rect.y * pageWidth,
        y: rect.x * pageHeight,
        rotate: 90,
        width: rect.w * displayedWidth,
        height: rect.h * displayedHeight,
      };
    }
    case 180:
      return {
        x: (1 - rect.x) * pageWidth,
        y: rect.y * pageHeight,
        rotate: 180,
        width: rect.w * pageWidth,
        height: rect.h * pageHeight,
      };
    case 270: {
      const displayedWidth = pageHeight;
      const displayedHeight = pageWidth;
      return {
        x: (1 - rect.y) * pageWidth,
        y: (1 - rect.x) * pageHeight,
        rotate: 270,
        width: rect.w * displayedWidth,
        height: rect.h * displayedHeight,
      };
    }
    default:
      return {
        x: rect.x * pageWidth,
        y: (1 - rect.y - rect.h) * pageHeight,
        rotate: 0,
        width: rect.w * pageWidth,
        height: rect.h * pageHeight,
      };
  }
}

/** Baseline anchor for line `index` of a rotated text box. */
export function lineAnchor(
  placement: Placement,
  fontSize: number,
  lineHeight: number,
  index: number,
): { x: number; y: number } {
  const step = fontSize * lineHeight * index;
  switch (placement.rotate) {
    case 90:
      return { x: placement.x + fontSize * 0.8 + step, y: placement.y };
    case 180:
      return { x: placement.x, y: placement.y + fontSize * 0.8 + step };
    case 270:
      return { x: placement.x - fontSize * 0.8 - step, y: placement.y };
    default:
      return { x: placement.x, y: placement.y + placement.height - fontSize * 0.8 - step };
  }
}

export function formatEntryDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  if (!year || !month || !day) return iso;
  return `${Number(day)}/${Number(month)}/${year}`;
}

export interface FillContext {
  template: Template;
  weeks: WeekRecord[];
  intake: IntakeAnswers;
  studentDetails: StudentDetails;
  programme: string;
  watermark?: boolean;
  /** Called at most twice per field when the text does not fit at the minimum size. */
  shorten?: (text: string, maxChars: number) => Promise<string>;
}

export interface OverflowFlag {
  week: number;
  field: string;
  reason: 'truncated';
}

export interface FieldPlacement {
  week: number;
  field: string;
  page: number;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  lines: number;
  truncated: boolean;
}

export interface FillResult {
  bytes: Buffer;
  overflow: OverflowFlag[];
  pages: number;
  filledFields: number;
  placements: FieldPlacement[];
}

function studentValue(context: FillContext, key: string | undefined): string {
  if (!key) return '';
  const direct = context.studentDetails[key as keyof StudentDetails];
  if (direct) return direct;
  switch (key) {
    case 'company':
      return context.intake.company;
    case 'unit':
      return context.intake.unit;
    case 'department':
      return context.programme;
    case 'programme':
      return context.programme;
    default:
      return '';
  }
}

function fieldText(field: TemplateField, context: FillContext, week?: WeekRecord): string {
  const day = week && typeof field.dayIndex === 'number' ? week.days[field.dayIndex] : undefined;
  switch (field.type) {
    case 'date':
      return day ? formatEntryDate(day.date) : '';
    case 'day_name':
      return day ? weekdayName(day.date) : '';
    case 'week_number':
      return week ? String(week.weekNumber) : '';
    case 'daily_activity':
      return day?.entry ?? '';
    case 'weekly_summary':
      return week?.weeklySummary ?? context.intake.weeklyHighlights ?? '';
    case 'student_detail':
      return studentValue(context, field.detailKey);
    case 'signature':
    case 'supervisor_remarks':
    case 'blank':
      return '';
    default:
      return '';
  }
}

async function drawField(
  page: PDFPage,
  field: TemplateField,
  text: string,
  font: PDFFont,
  shorten?: (text: string, maxChars: number) => Promise<string>,
): Promise<{ truncated: boolean; fontSize: number; lineCount: number; placement: Placement }> {
  const { width: pageWidth, height: pageHeight } = page.getSize();
  const rotation = page.getRotation().angle;
  const placement = placeRect(field.rect, pageWidth, pageHeight, rotation);
  const lineHeight = 1.15;
  const measure = (value: string, size: number) => font.widthOfTextAtSize(value, size);

  let content = text;
  let fit = fitText({
    text: content,
    width: placement.width,
    height: placement.height,
    minFontSize: field.fontSize.min,
    maxFontSize: field.fontSize.max,
    measure,
    lineHeight,
  });

  if (fit.overflow && shorten) {
    const budget = approximateCharsPerLine(fit.fontSize, placement.width) * Math.max(1, fit.maxLines);
    try {
      const shortened = await shorten(content, Math.max(20, budget - 2));
      if (shortened && shortened.length < content.length) {
        content = shortened;
        fit = fitText({
          text: content,
          width: placement.width,
          height: placement.height,
          minFontSize: field.fontSize.min,
          maxFontSize: field.fontSize.max,
          measure,
          lineHeight,
        });
      }
    } catch {
      // Fall through to truncation.
    }
  }

  fit.lines.forEach((line, index) => {
    if (!line) return;
    const anchor = lineAnchor(placement, fit.fontSize, lineHeight, index);
    let { x, y } = anchor;
    if (field.align === 'center') {
      const shift = (placement.width - measure(line, fit.fontSize)) / 2;
      if (placement.rotate === 0) x += shift;
      else if (placement.rotate === 90) y += shift;
      else if (placement.rotate === 180) x -= shift;
      else y -= shift;
    }
    page.drawText(line, {
      x,
      y,
      size: fit.fontSize,
      font,
      color: rgb(0.09, 0.1, 0.12),
      rotate: degrees(placement.rotate),
    });
  });

  return {
    truncated: fit.truncated,
    fontSize: fit.fontSize,
    lineCount: fit.lines.length,
    placement,
  };
}

export function drawWatermark(page: PDFPage, font: PDFFont): void {
  const { width, height } = page.getSize();
  const text = 'PREVIEW - uselogit.cv';
  const size = 30;
  const textWidth = font.widthOfTextAtSize(text, size);
  page.drawText(text, {
    x: Math.max(20, (width - textWidth * 0.8) / 2),
    y: height * 0.45,
    size,
    font,
    color: rgb(0.4, 0.45, 0.55),
    opacity: 0.22,
    rotate: degrees(30),
  });
}

export async function fillTemplate(
  pdfBytes: Buffer,
  context: FillContext,
  fontBytes: Buffer,
): Promise<FillResult> {
  const pdf = await PDFDocument.load(pdfBytes, { updateMetadata: false });
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const pages = pdf.getPages();
  const overflow: OverflowFlag[] = [];
  const placements: FieldPlacement[] = [];
  let filledFields = 0;

  const unit = context.template.unit;
  const weeks = context.weeks.slice(0, unit.maxUnits);

  for (let w = 0; w < weeks.length; w += 1) {
    const week = weeks[w]!;
    for (const field of unit.fields) {
      if (!isFieldFillable(field)) continue;
      const text = fieldText(field, context, week);
      if (!text) continue;
      const pageIndex = unit.firstEntryPage + w * unit.pagesPerUnit + field.page;
      const page = pages[pageIndex];
      if (!page) {
        overflow.push({ week: week.weekNumber, field: field.key, reason: 'truncated' });
        continue;
      }
      const outcome = await drawField(page, field, text, font, context.shorten);
      placements.push({
        week: week.weekNumber,
        field: field.key,
        page: pageIndex,
        x: outcome.placement.x,
        y: outcome.placement.y,
        width: outcome.placement.width,
        height: outcome.placement.height,
        fontSize: outcome.fontSize,
        lines: outcome.lineCount,
        truncated: outcome.truncated,
      });
      if (outcome.truncated) {
        overflow.push({ week: week.weekNumber, field: field.key, reason: 'truncated' });
      }
      filledFields += 1;
    }
  }

  for (const field of context.template.staticFields) {
    if (!isFieldFillable(field)) continue;
    const page = pages[field.page];
    if (!page) continue;
    const text = fieldText(field, context);
    if (!text) continue;
    const outcome = await drawField(page, field, text, font, context.shorten);
    placements.push({
      week: 0,
      field: field.key,
      page: field.page,
      x: outcome.placement.x,
      y: outcome.placement.y,
      width: outcome.placement.width,
      height: outcome.placement.height,
      fontSize: outcome.fontSize,
      lines: outcome.lineCount,
      truncated: outcome.truncated,
    });
    if (outcome.truncated) overflow.push({ week: 0, field: field.key, reason: 'truncated' });
    filledFields += 1;
  }

  if (context.watermark) {
    for (const page of pages) drawWatermark(page, font);
  }

  return {
    bytes: Buffer.from(await pdf.save({ useObjectStreams: true })),
    overflow,
    pages: pages.length,
    filledFields,
    placements,
  };
}
