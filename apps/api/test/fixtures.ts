import { PDFDocument, StandardFonts, degrees, rgb } from 'pdf-lib';
import sharp from 'sharp';

export interface LogbookOptions {
  pages?: number;
  rotation?: number;
  withText?: boolean;
}

/** A digital, text-bearing logbook PDF with a weekly table on each entry page. */
export async function makeLogbookPdf(options: LogbookOptions = {}): Promise<Buffer> {
  const { pages = 3, rotation = 0, withText = true } = options;
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  for (let index = 0; index < pages; index += 1) {
    const page = pdf.addPage([595.28, 841.89]);
    if (rotation) page.setRotation(degrees(rotation));
    page.drawRectangle({ x: 30, y: 30, width: 535, height: 782, borderColor: rgb(0.2, 0.2, 0.2), borderWidth: 0.8 });
    page.drawText('WEEKLY LOGBOOK', { x: 48, y: 780, size: 16, font: bold });
    page.drawText(`Page ${index + 1}`, { x: 500, y: 780, size: 9, font });
    if (withText) {
      page.drawText('Week ending: ____________', { x: 48, y: 750, size: 10, font });
      for (let row = 0; row < 5; row += 1) {
        const y = 690 - row * 100;
        page.drawRectangle({ x: 48, y, width: 500, height: 80, borderColor: rgb(0.6, 0.6, 0.6), borderWidth: 0.5 });
        page.drawText(`Day ${row + 1}`, { x: 56, y: y + 60, size: 9, font });
        page.drawText('Activity: ________________________________________', {
          x: 150,
          y: y + 45,
          size: 9,
          font,
        });
      }
    }
  }
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}

/** A page rendered to an image then wrapped in a PDF: no text layer, like a scan. */
export async function makeScanPdf(): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="595" height="842">
    <rect width="595" height="842" fill="#f7f4ea"/>
    <rect x="30" y="30" width="535" height="782" fill="none" stroke="#444" stroke-width="2"/>
    <text x="48" y="80" font-family="Arial" font-size="20" fill="#222">WEEKLY LOGBOOK</text>
    ${Array.from({ length: 8 }, (_, i) => `<line x1="48" y1="${140 + i * 70}" x2="548" y2="${140 + i * 70}" stroke="#999"/>`).join('')}
  </svg>`;
  const jpeg = await sharp(Buffer.from(svg)).jpeg({ quality: 80 }).toBuffer();
  const pdf = await PDFDocument.create();
  const image = await pdf.embedJpg(jpeg);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawImage(image, { x: 0, y: 0, width: 595.28, height: 841.89 });
  return Buffer.from(await pdf.save());
}

/** A phone photo of a page, with an EXIF orientation tag (6 = rotate 90 clockwise). */
export async function makePhotoJpeg(orientation = 1): Promise<Buffer> {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <rect width="900" height="1200" fill="#ffffff"/>
    <rect x="40" y="40" width="820" height="1120" fill="none" stroke="#333" stroke-width="4"/>
    <text x="70" y="120" font-family="Arial" font-size="34" fill="#111">LOG BOOK PAGE</text>
    ${Array.from({ length: 12 }, (_, i) => `<line x1="70" y1="${200 + i * 70}" x2="830" y2="${200 + i * 70}" stroke="#bbb" stroke-width="2"/>`).join('')}
  </svg>`;
  let pipeline = sharp(Buffer.from(svg));
  if (orientation > 1) pipeline = pipeline.withMetadata({ orientation });
  return pipeline.jpeg({ quality: 82 }).toBuffer();
}

/** 51 pages, to prove the page-count limit. */
export async function makeLongPdf(pageCount = 51): Promise<Buffer> {
  return makeLogbookPdf({ pages: pageCount, withText: false });
}
