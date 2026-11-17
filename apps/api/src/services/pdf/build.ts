import { PDFDocument, EncryptedPDFError } from 'pdf-lib';
import sharp from 'sharp';

export const A4 = { width: 595.28, height: 841.89 };

export class PdfInputError extends Error {
  constructor(
    public readonly code: 'ENCRYPTED_PDF' | 'UNSUPPORTED_FILE' | 'TOO_MANY_PAGES' | 'PROCESSING_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'PdfInputError';
  }
}

export function looksLikePdf(bytes: Buffer): boolean {
  return bytes.subarray(0, 5).toString('latin1') === '%PDF-';
}

export async function loadPdf(bytes: Buffer): Promise<PDFDocument> {
  if (!looksLikePdf(bytes)) throw new PdfInputError('UNSUPPORTED_FILE', 'That file is not a PDF.');
  let pdf: PDFDocument;
  try {
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: false });
  } catch (error) {
    if (error instanceof EncryptedPDFError) {
      throw new PdfInputError(
        'ENCRYPTED_PDF',
        'This PDF is password-protected. Remove the password (print to PDF) and upload again.',
      );
    }
    const message = error instanceof Error ? error.message : '';
    if (/encrypt/i.test(message)) {
      throw new PdfInputError(
        'ENCRYPTED_PDF',
        'This PDF is password-protected. Remove the password (print to PDF) and upload again.',
      );
    }
    throw new PdfInputError('UNSUPPORTED_FILE', 'We could not read this PDF. It may be corrupt.');
  }
  try {
    if (pdf.getPageCount() < 1) throw new Error('no pages');
  } catch {
    throw new PdfInputError('UNSUPPORTED_FILE', 'We could not read this PDF. It may be corrupt.');
  }
  return pdf;
}

export interface PdfInfo {
  pages: number;
  width: number;
  height: number;
  /** True when pages differ notably in size. */
  mixedSizes: boolean;
}

export function pdfInfo(pdf: PDFDocument): PdfInfo {
  const pages = pdf.getPageCount();
  const first = pdf.getPage(0).getSize();
  let mixed = false;
  for (let i = 1; i < pages; i += 1) {
    const size = pdf.getPage(i).getSize();
    if (Math.abs(size.width - first.width) > 2 || Math.abs(size.height - first.height) > 2) {
      mixed = true;
      break;
    }
  }
  return { pages, width: first.width, height: first.height, mixedSizes: mixed };
}

export interface ImageInput {
  name: string;
  bytes: Buffer;
}

/** EXIF-rotate, downscale and compile images into one PDF, one image per A4 page. */
export async function imagesToPdf(files: ImageInput[]): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  for (const file of files) {
    let jpeg: Buffer;
    try {
      jpeg = await sharp(file.bytes, { failOn: 'error', limitInputPixels: 40_000_000 })
        .rotate()
        .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 75, mozjpeg: true })
        .toBuffer();
    } catch {
      throw new PdfInputError('UNSUPPORTED_FILE', `${file.name} is not a readable image.`);
    }
    const image = await pdf.embedJpg(jpeg);
    const page = pdf.addPage([A4.width, A4.height]);
    const margin = 16;
    const maxWidth = A4.width - margin * 2;
    const maxHeight = A4.height - margin * 2;
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height);
    const width = image.width * scale;
    const height = image.height * scale;
    page.drawImage(image, {
      x: (A4.width - width) / 2,
      y: (A4.height - height) / 2,
      width,
      height,
    });
  }
  return Buffer.from(await pdf.save({ useObjectStreams: true }));
}
