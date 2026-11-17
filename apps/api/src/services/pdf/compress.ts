import { promises as fs } from 'node:fs';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { hasCommand, runCommand } from './tools.js';

export interface CompressResult {
  bytes: Buffer;
  method: 'ghostscript-ebook' | 'ghostscript-screen' | 'pdf-lib' | 'none';
}

/**
 * Ghostscript compression when available; otherwise a lossless-ish pdf-lib re-save.
 * The caller still enforces the 6 MB target / 10 MB hard limit.
 */
export async function compressPdf(
  input: Buffer,
  options: { tmpDir: string; gsBin: string; targetBytes: number },
): Promise<CompressResult> {
  if (hasCommand(options.gsBin)) {
    const workDir = path.join(options.tmpDir, `gs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.mkdir(workDir, { recursive: true });
    try {
      const source = path.join(workDir, 'in.pdf');
      const output = path.join(workDir, 'out.pdf');
      await fs.writeFile(source, input);
      for (const preset of ['ebook', 'screen'] as const) {
        const result = runCommand(
          options.gsBin,
          [
            '-sDEVICE=pdfwrite',
            `-dPDFSETTINGS=/${preset}`,
            '-dSAFER',
            '-dNOPAUSE',
            '-dBATCH',
            '-dQUIET',
            `-sOutputFile=${output}`,
            source,
          ],
          { timeoutMs: 180_000 },
        );
        if (result.ok) {
          const compressed = await fs.readFile(output).catch(() => null);
          if (compressed && compressed.byteLength < input.byteLength) {
            if (compressed.byteLength <= options.targetBytes) {
              return { bytes: compressed, method: preset === 'ebook' ? 'ghostscript-ebook' : 'ghostscript-screen' };
            }
            if (preset === 'ebook') continue;
            return { bytes: compressed, method: 'ghostscript-screen' };
          }
        }
      }
    } finally {
      await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  try {
    const pdf = await PDFDocument.load(input, { updateMetadata: false });
    const bytes = Buffer.from(await pdf.save({ useObjectStreams: true, addDefaultPage: false }));
    if (bytes.byteLength < input.byteLength) return { bytes, method: 'pdf-lib' };
  } catch {
    // Fall through to the original bytes.
  }
  return { bytes: input, method: 'none' };
}
