import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { hasCommand, runCommand } from './tools.js';

export interface ThumbResult {
  kind: 'raster' | 'placeholder';
  pages: Buffer[];
}

function placeholderSvg(pageNumber: number, pageCount: number, width = 595, height = 842): string {
  const lines: string[] = [];
  const top = 150;
  for (let i = 0; i < 18; i += 1) {
    const y = top + i * 34;
    lines.push(
      `<line x1="60" y1="${y}" x2="${width - 60}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <rect x="40" y="40" width="${width - 80}" height="${height - 80}" fill="none" stroke="#d1d5db" stroke-width="1.5"/>
  <text x="${width / 2}" y="96" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#374151">LOGIT page preview</text>
  <text x="${width / 2}" y="122" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#9ca3af">Page ${pageNumber} of ${pageCount} (server tools unavailable)</text>
  ${lines.join('\n')}
  <text x="${width / 2}" y="${height - 56}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" fill="#9ca3af">Local preview — production renders your real page</text>
</svg>`;
}

async function placeholderPages(pageCount: number): Promise<Buffer[]> {
  const pages: Buffer[] = [];
  for (let i = 1; i <= pageCount; i += 1) {
    pages.push(await sharp(Buffer.from(placeholderSvg(i, pageCount))).png().toBuffer());
  }
  return pages;
}

/**
 * Rasterises every page at `dpi`. Uses poppler when present (production Docker image),
 * otherwise returns labelled placeholders so the app still works locally.
 */
export async function renderPages(
  pdfBytes: Buffer,
  pageCount: number,
  dpi: number,
  tmpDir: string,
  pdftoppmBin: string,
): Promise<ThumbResult> {
  if (!hasCommand(pdftoppmBin)) {
    return { kind: 'placeholder', pages: await placeholderPages(pageCount) };
  }
  const workDir = path.join(tmpDir, `render-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
  await fs.mkdir(workDir, { recursive: true });
  try {
    const input = path.join(workDir, 'in.pdf');
    await fs.writeFile(input, pdfBytes);
    const prefix = path.join(workDir, 'page');
    const result = await runCommand(
      pdftoppmBin,
      ['-r', String(dpi), '-png', input, prefix],
      { timeoutMs: 180_000 },
    );
    if (!result.ok) return { kind: 'placeholder', pages: await placeholderPages(pageCount) };
    const files = (await fs.readdir(workDir))
      .filter((name) => name.startsWith('page') && name.endsWith('.png'))
      .sort((a, b) => {
        const na = Number(/(\d+)/.exec(a)?.[1] ?? 0);
        const nb = Number(/(\d+)/.exec(b)?.[1] ?? 0);
        return na - nb;
      });
    if (files.length === 0) return { kind: 'placeholder', pages: await placeholderPages(pageCount) };
    const pages = await Promise.all(files.map((name) => fs.readFile(path.join(workDir, name))));
    return { kind: 'raster', pages };
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** 64-bit difference hash as 16 hex chars, computed from a 9x8 grayscale version. */
export async function differenceHash(png: Buffer): Promise<string> {
  const { data } = await sharp(png)
    .greyscale()
    .resize(9, 8, { fit: 'fill' })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = '';
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const left = data[row * 9 + col] ?? 0;
      const right = data[row * 9 + col + 1] ?? 0;
      bits += left > right ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}
