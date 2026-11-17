/**
 * Text fitting for PDF fields. The caller supplies a measure function
 * (pdf-lib's font.widthOfTextAtSize in the API, a canvas approximation on the web for previews).
 */

export type MeasureFn = (text: string, fontSize: number) => number;

export interface WrapOptions {
  width: number;
  fontSize: number;
  measure: MeasureFn;
}

function hardBreak(word: string, width: number, fontSize: number, measure: MeasureFn): string[] {
  const parts: string[] = [];
  let current = '';
  for (const char of word) {
    const next = current + char;
    if (current && measure(next, fontSize) > width) {
      parts.push(current);
      current = char;
    } else {
      current = next;
    }
  }
  if (current) parts.push(current);
  return parts;
}

export function wrapText(text: string, options: WrapOptions): string[] {
  const { width, fontSize, measure } = options;
  const lines: string[] = [];
  for (const rawLine of text.replace(/\r\n/g, '\n').split('\n')) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push('');
      continue;
    }
    let current = '';
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (measure(candidate, fontSize) <= width) {
        current = candidate;
        continue;
      }
      if (current) lines.push(current);
      if (measure(word, fontSize) <= width) {
        current = word;
      } else {
        const pieces = hardBreak(word, width, fontSize, measure);
        const last = pieces.pop() ?? '';
        lines.push(...pieces);
        current = last;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

export interface FitInput {
  text: string;
  width: number;
  height: number;
  minFontSize: number;
  maxFontSize: number;
  measure: MeasureFn;
  lineHeight?: number;
}

export interface FitResult {
  lines: string[];
  fontSize: number;
  overflow: boolean;
  truncated: boolean;
  maxLines: number;
}

export function maxLinesFor(height: number, fontSize: number, lineHeight = 1.2): number {
  return Math.max(1, Math.floor(height / (fontSize * lineHeight)));
}

export function fitText(input: FitInput): FitResult {
  const lineHeight = input.lineHeight ?? 1.2;
  const maxFont = Math.max(input.maxFontSize, input.minFontSize);
  let size = maxFont;
  while (size >= input.minFontSize - 1e-6) {
    const wrapped = wrapText(input.text, {
      width: input.width,
      fontSize: size,
      measure: input.measure,
    });
    if (wrapped.length * size * lineHeight <= input.height + 0.01) {
      return {
        lines: wrapped,
        fontSize: size,
        overflow: false,
        truncated: false,
        maxLines: maxLinesFor(input.height, size, lineHeight),
      };
    }
    size -= 0.5;
  }
  const minSize = input.minFontSize;
  const wrapped = wrapText(input.text, { width: input.width, fontSize: minSize, measure: input.measure });
  const maxLines = maxLinesFor(input.height, minSize, lineHeight);
  if (wrapped.length <= maxLines) {
    return { lines: wrapped, fontSize: minSize, overflow: true, truncated: false, maxLines };
  }
  const kept = wrapped.slice(0, Math.max(1, maxLines - 1));
  const tail = wrapped[maxLines - 1] ?? '';
  kept.push(`${tail.replace(/\s+$/, '')}...`);
  return { lines: kept, fontSize: minSize, overflow: true, truncated: true, maxLines };
}

/** Rough character budget used to ask the AI for a shorter entry before we truncate. */
export function approximateCharsPerLine(fontSize: number, width: number): number {
  return Math.max(10, Math.floor(width / (fontSize * 0.5)));
}

export function approximateTextLines(text: string, charsPerLine: number): number {
  return text
    .split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / charsPerLine)), 0);
}
