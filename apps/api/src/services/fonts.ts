import { promises as fs } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FONT_URL = new URL('../../assets/fonts/NotoSans-Regular.ttf', import.meta.url);
let fontCache: Buffer | null = null;

/** Noto Sans Regular, embedded (subset) into every generated PDF. */
export async function loadFontBytes(): Promise<Buffer> {
  if (fontCache) return fontCache;
  try {
    fontCache = await fs.readFile(fileURLToPath(FONT_URL));
    return fontCache;
  } catch {
    throw new Error(`Font missing at ${fileURLToPath(FONT_URL)}`);
  }
}
