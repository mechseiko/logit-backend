import { PDFDocument, StandardFonts } from 'pdf-lib';
import type { AppConfig } from '../../config.js';
import { hasCommand } from './tools.js';
import { renderPages } from './thumbs.js';

export interface ToolStatus {
  ghostscript: boolean;
  poppler: boolean;
  pdftotext: boolean;
  pdfinfo: boolean;
  render72: boolean;
  render110: boolean;
  checkedAt: string;
}

let cached: ToolStatus | null = null;

async function tinyPdf(): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText('LOGIT pipeline self-test', { x: 40, y: 780, size: 14, font });
  return Buffer.from(await pdf.save());
}

/**
 * Proves the system PDF pipeline at boot: both ghostscript and poppler present, and both
 * 72 dpi (student thumbnails) and 110 dpi (admin editor) renders producing real pixels.
 */
export async function runToolSelfTest(config: AppConfig): Promise<ToolStatus> {
  const status: ToolStatus = {
    ghostscript: hasCommand(config.pdfTools.ghostscript),
    poppler: hasCommand(config.pdfTools.pdftoppm),
    pdftotext: hasCommand(config.pdfTools.pdftotext),
    pdfinfo: hasCommand(config.pdfTools.pdfinfo),
    render72: false,
    render110: false,
    checkedAt: new Date().toISOString(),
  };
  try {
    const pdf = await tinyPdf();
    const [at72, at110] = await Promise.all([
      renderPages(pdf, 1, 72, `${config.dataDir}/tmp`, config.pdfTools.pdftoppm),
      renderPages(pdf, 1, 110, `${config.dataDir}/tmp`, config.pdfTools.pdftoppm),
    ]);
    status.render72 = at72.kind === 'raster' && at72.pages.length === 1;
    status.render110 = at110.kind === 'raster' && at110.pages.length === 1;
  } catch {
    status.render72 = false;
    status.render110 = false;
  }
  cached = status;
  return status;
}

export function toolStatus(): ToolStatus | null {
  return cached;
}

/** Production requires the real raster pipeline (compression alone can fall back). */
export function pipelineHealthy(status: ToolStatus | null): boolean {
  if (!status) return false;
  return status.poppler && status.ghostscript && status.render72 && status.render110;
}
