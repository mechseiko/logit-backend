import { describe, expect, it } from 'vitest';
import { approximateCharsPerLine, fitText, maxLinesFor, wrapText } from '../src/index.js';

const measure = (text: string, fontSize: number) => text.length * fontSize * 0.5;

describe('wrapText', () => {
  it('wraps at word boundaries', () => {
    const lines = wrapText('hello world again', { width: 30, fontSize: 10, measure });
    expect(lines).toEqual(['hello', 'world', 'again']);
  });

  it('hard-breaks a word that is wider than the box', () => {
    const lines = wrapText('supercalifragilistic', { width: 20, fontSize: 10, measure });
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join('')).toBe('supercalifragilistic');
  });

  it('keeps explicit newlines', () => {
    const lines = wrapText('one\ntwo', { width: 100, fontSize: 10, measure });
    expect(lines).toEqual(['one', 'two']);
  });
});

describe('fitText', () => {
  it('keeps the maximum size when the text fits', () => {
    const result = fitText({
      text: 'short entry',
      width: 200,
      height: 40,
      minFontSize: 6,
      maxFontSize: 12,
      measure,
    });
    expect(result.fontSize).toBe(12);
    expect(result.overflow).toBe(false);
    expect(result.lines[0]).toBe('short entry');
  });

  it('shrinks the font before overflowing', () => {
    const text = 'This is a reasonably long logbook entry that needs a smaller font to fit the box';
    const result = fitText({
      text,
      width: 200,
      height: 30,
      minFontSize: 6,
      maxFontSize: 12,
      measure,
    });
    expect(result.overflow).toBe(false);
    expect(result.fontSize).toBeLessThan(12);
  });

  it('truncates with an ellipsis when even the minimum size overflows', () => {
    const text = 'word '.repeat(120);
    const result = fitText({
      text,
      width: 100,
      height: 20,
      minFontSize: 8,
      maxFontSize: 10,
      measure,
    });
    expect(result.overflow).toBe(true);
    expect(result.truncated).toBe(true);
    expect(result.lines.at(-1)).toMatch(/\.\.\.$/);
    expect(result.lines.length).toBeLessThanOrEqual(result.maxLines);
  });
});

describe('helpers', () => {
  it('calculates how many lines fit', () => {
    expect(maxLinesFor(48, 10, 1.2)).toBe(4);
  });

  it('estimates characters per line from font size and width', () => {
    expect(approximateCharsPerLine(9, 270)).toBe(60);
  });
});
