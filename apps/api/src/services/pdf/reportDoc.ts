import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, StandardFonts, type PDFFont, type PDFPage, degrees, rgb } from 'pdf-lib';
import type { FontFamily, ReportFacts, ReportTemplate } from '@logit/shared';
import { A4 } from './build.js';

/**
 * The report document: what the OAU examples actually look like, built from the student's facts.
 *
 * Front matter is laid out but never invented — the declaration and certification pages carry blank
 * signature lines because a person has to sign them. The literature chapter only exists when the
 * student supplied sources. Everything drawn goes through clean(), because the standard PDF faces
 * cannot print a curly quote.
 */

const MARGIN = 64;
const INK = rgb(0.07, 0.08, 0.08);
const MUTED = rgb(0.38, 0.4, 0.4);
const RULE = rgb(0.78, 0.79, 0.78);
const BRAND = rgb(0.04, 0.42, 0.3);

export interface ReportDocContext {
  template: ReportTemplate;
  facts: ReportFacts;
  sections: { heading: string; body: string }[];
  student: { name: string; matricNo: string; department: string; institution: string };
  fontFamily?: FontFamily;
  watermark?: boolean;
}

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
      if (font.widthOfTextAtSize(word, size) > width) {
        let chunk = '';
        for (const character of word) {
          if (font.widthOfTextAtSize(chunk + character, size) > width) {
            lines.push(chunk);
            chunk = character;
          } else chunk += character;
        }
        current = chunk;
      } else current = word;
    }
    if (current) lines.push(current);
  }
  return lines;
}

function text(
  page: PDFPage,
  font: PDFFont,
  value: string,
  options: { x: number; y: number; size?: number; color?: typeof INK },
) {
  page.drawText(clean(value), {
    x: options.x,
    y: options.y,
    size: options.size ?? 11,
    font,
    color: options.color ?? INK,
  });
}

function centered(page: PDFPage, font: PDFFont, value: string, y: number, size: number, color = INK) {
  const { width } = page.getSize();
  const cleanValue = clean(value);
  page.drawText(cleanValue, {
    x: (width - font.widthOfTextAtSize(cleanValue, size)) / 2,
    y,
    size,
    font,
    color,
  });
}

function footer(page: PDFPage, font: PDFFont, label: string) {
  const { width } = page.getSize();
  page.drawText(clean(label), { x: MARGIN, y: 30, size: 8, font, color: MUTED });
  page.drawText('Logit', {
    x: width - MARGIN - 26,
    y: 30,
    size: 8,
    font,
    color: MUTED,
  });
}

function titlePage(font: PDFFont, context: ReportDocContext): (pdf: PDFDocument) => PDFPage {
  return (pdf) => {
    const page = pdf.addPage([A4.width, A4.height]);
    const { width, height } = page.getSize();
    page.drawRectangle({ x: 0, y: height - 6, width, height: 6, color: BRAND });
    centered(page, font, context.template.title, height - 150, 20);
    centered(page, font, context.facts.title, height - 186, 15, MUTED);
    centered(page, font, 'BY', height - 260, 10, MUTED);
    centered(page, font, context.student.name || 'Student name', height - 288, 16);
    centered(page, font, context.student.matricNo || 'Matric number', height - 312, 12, MUTED);
    centered(page, font, context.student.department || 'Department', height - 344, 12);
    centered(page, font, context.student.institution || context.facts.institution || 'Institution', height - 366, 12);
    if (context.facts.company) {
      centered(page, font, `Attachment at ${context.facts.company}`, height - 404, 11, MUTED);
    }
    centered(
      page,
      font,
      new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
      height - 452,
      11,
      MUTED,
    );
    footer(page, font, '');
    return page;
  };
}

function declarationPage(font: PDFFont, context: ReportDocContext): (pdf: PDFDocument) => PDFPage {
  return (pdf) => {
    const page = pdf.addPage([A4.width, A4.height]);
    const { width, height } = page.getSize();
    centered(page, font, 'DECLARATION', height - 110, 14);
    let y = height - 160;
    const lines = wrap(
      `I, ${context.student.name || 'the student'}, declare that this report is my own work, written from my own experience on attachment${context.facts.company ? ` at ${context.facts.company}` : ''}. Sources I used are listed in the references.`,
      font,
      11,
      width - MARGIN * 2,
    );
    for (const line of lines) {
      text(page, font, line, { x: MARGIN, y });
      y -= 18;
    }
    y -= 60;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 200, y }, thickness: 0.6, color: RULE });
    text(page, font, 'Student signature and date', { x: MARGIN, y: y - 16, size: 9, color: MUTED });
    footer(page, font, context.template.name);
    return page;
  };
}

function certificationPage(font: PDFFont, context: ReportDocContext): (pdf: PDFDocument) => PDFPage {
  return (pdf) => {
    const page = pdf.addPage([A4.width, A4.height]);
    const { width, height } = page.getSize();
    centered(page, font, 'CERTIFICATION', height - 110, 14);
    let y = height - 160;
    const lines = wrap(
      'This is to certify that this report was written by the student named below, and that it describes work carried out during the industrial attachment.',
      font,
      11,
      width - MARGIN * 2,
    );
    for (const line of lines) {
      text(page, font, line, { x: MARGIN, y });
      y -= 18;
    }
    y -= 40;
    for (const label of [
      'Student name and matric number',
      'Industry-based supervisor (name, signature, stamp)',
      'Head of Department (name, signature)',
    ]) {
      page.drawLine({ start: { x: MARGIN, y }, end: { x: width - MARGIN, y }, thickness: 0.6, color: RULE });
      text(page, font, label, { x: MARGIN, y: y - 16, size: 9, color: MUTED });
      y -= 86;
    }
    footer(page, font, context.template.name);
    return page;
  };
}

interface BodyPage {
  page: PDFPage;
  starts: Array<{ heading: string; page: number }>;
}

function buildBody(
  pdf: PDFDocument,
  font: PDFFont,
  context: ReportDocContext,
  startPageNumber: number,
): { pages: BodyPage[]; chapters: Array<{ heading: string; page: number }> } {
  const pages: BodyPage[] = [];
  const chapters: Array<{ heading: string; page: number }> = [];
  const { width, height } = pageSize();
  let page: PDFPage = pdf.addPage([width, height]);
  let y = height - MARGIN - 20;

  const newPage = () => {
    footer(page, font, context.template.name);
    page = pdf.addPage([width, height]);
    pages.push({ page, starts: [] });
    y = height - MARGIN - 20;
  };

  pages.push({ page, starts: [] });

  let chapterNumber = 0;
  for (const section of context.sections) {
    // The abstract is front matter, not a numbered chapter.
    const isChapter = section.heading.toLowerCase() !== 'abstract';
    if (isChapter) chapterNumber += 1;
    const heading = section.heading.toUpperCase();
    if (y < height - MARGIN - 100) newPage();
    else y -= 26;

    if (isChapter) centered(page, font, `CHAPTER ${chapterNumber}`, height - MARGIN - 20, 10, MUTED);
    y = height - MARGIN - 52;
    centered(page, font, heading, y, 14);
    chapters.push({
      heading: isChapter ? `Chapter ${chapterNumber}: ${section.heading}` : section.heading,
      page: startPageNumber + pages.length - 1,
    });
    y -= 40;

    const lines = wrap(section.body, font, 11, width - MARGIN * 2);
    for (const line of lines) {
      if (y < MARGIN + 50) newPage();
      text(page, font, line, { x: MARGIN, y });
      y -= 18;
    }
    y -= 18;
  }

  if (context.facts.sources && context.facts.sources.trim().length > 0) {
    const sources = context.facts.sources
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    if (sources.length > 0) {
      newPage();
      centered(page, font, 'REFERENCES', height - MARGIN - 20, 14);
      y = height - MARGIN - 64;
      chapters.push({ heading: 'References', page: startPageNumber + pages.length - 1 });
      for (const [index, source] of sources.entries()) {
        const lines = wrap(`${index + 1}. ${source}`, font, 10, width - MARGIN * 2);
        for (const line of lines) {
          if (y < MARGIN + 50) newPage();
          text(page, font, line, { x: MARGIN, y, size: 10 });
          y -= 15;
        }
        y -= 6;
      }
    }
  }

  footer(page, font, context.template.name);
  return { pages, chapters };
}

function pageSize() {
  return { width: A4.width, height: A4.height };
}

function tocPage(
  font: PDFFont,
  context: ReportDocContext,
  entries: Array<{ heading: string; page: number }>,
): (pdf: PDFDocument) => PDFPage {
  return (pdf) => {
    const page = pdf.addPage([A4.width, A4.height]);
    const { width, height } = page.getSize();
    centered(page, font, 'TABLE OF CONTENTS', height - 110, 14);
    let y = height - 160;
    for (const entry of entries) {
      const value = clean(entry.heading);
      const number = String(entry.page);
      text(page, font, value, { x: MARGIN, y, size: 10.5 });
      page.drawText(number, {
        x: width - MARGIN - font.widthOfTextAtSize(number, 10.5),
        y,
        size: 10.5,
        font,
        color: INK,
      });
      const dots = '.'.repeat(
        Math.max(2, Math.floor((width - MARGIN * 2 - font.widthOfTextAtSize(value, 10.5) - 20) / 3)),
      );
      page.drawText(dots, { x: MARGIN + font.widthOfTextAtSize(value, 10.5) + 4, y, size: 8, font, color: RULE });
      y -= 22;
      if (y < MARGIN + 40) break;
    }
    footer(page, font, context.template.name);
    return page;
  };
}

export async function buildReportDocument(
  context: ReportDocContext,
  fontBytes: Buffer,
): Promise<{ bytes: Buffer; pages: number }> {
  const pdf = await PDFDocument.create();
  const family: FontFamily = context.fontFamily ?? 'sans';
  let font: PDFFont;
  if (family === 'serif') font = await pdf.embedFont(StandardFonts.TimesRoman);
  else if (family === 'mono') font = await pdf.embedFont(StandardFonts.Courier);
  else {
    pdf.registerFontkit(fontkit);
    font = await pdf.embedFont(fontBytes, { subset: true });
  }

  pdf.setTitle(context.facts.title);
  pdf.setCreator('Logit');
  pdf.setAuthor('Logit');

  // Pass one: measure the body so the table of contents carries real page numbers.
  const measure = await PDFDocument.create();
  const measureFont =
    family === 'sans'
      ? await (async () => {
          measure.registerFontkit(fontkit);
          return measure.embedFont(fontBytes, { subset: true });
        })()
      : await measure.embedFont(family === 'serif' ? StandardFonts.TimesRoman : StandardFonts.Courier);
  const frontMatter = 4; // title, declaration, certification, contents
  const measured = buildBody(measure, measureFont, context, frontMatter + 1);

  titlePage(font, context)(pdf);
  declarationPage(font, context)(pdf);
  certificationPage(font, context)(pdf);
  tocPage(font, context, measured.chapters)(pdf);
  buildBody(pdf, font, context, frontMatter + 1);

  if (context.watermark) {
    for (const page of pdf.getPages()) {
      const { width, height } = page.getSize();
      page.drawText('LOGIT PREVIEW', {
        x: width / 2 - 140,
        y: height / 2,
        size: 44,
        font,
        color: rgb(0.86, 0.88, 0.86),
        rotate: degrees(32),
      });
    }
  }

  const bytes = Buffer.from(await pdf.save({ useObjectStreams: true }));
  return { bytes, pages: pdf.getPageCount() };
}
