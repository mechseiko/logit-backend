import { describe, expect, it } from 'vitest';
import {
  fingerprintSimilarity,
  hammingDistance,
  pageSizeKey,
  pageSizeMatches,
  validateTemplate,
  type Template,
} from '../src/index.js';

export function makeTemplate(overrides: Partial<Template> = {}): Template {
  return {
    id: 'tpl_test',
    name: 'Test layout',
    schoolIds: [],
    programmes: ['SIWES'],
    pageSizeKey: '595x842',
    fingerprint: { pageCount: 2, dhash: [] },
    unit: {
      pagesPerUnit: 1,
      firstEntryPage: 1,
      maxUnits: 26,
      daysPerUnit: 5,
      fields: [
        {
          key: 'activity_0',
          type: 'daily_activity',
          page: 0,
          rect: { x: 0.3, y: 0.2, w: 0.6, h: 0.1 },
          dayIndex: 0,
          fontSize: { min: 6.5, max: 9 },
          fill: true,
        },
      ],
    },
    staticFields: [
      {
        key: 'name',
        type: 'student_detail',
        page: 0,
        rect: { x: 0.2, y: 0.3, w: 0.6, h: 0.04 },
        detailKey: 'fullName',
        fontSize: { min: 8, max: 12 },
        fill: true,
      },
    ],
    status: 'draft',
    version: 1,
    ...overrides,
  };
}

describe('template validation', () => {
  it('accepts a well formed template', () => {
    expect(validateTemplate(makeTemplate()).ok).toBe(true);
  });

  it('requires a daily activity field', () => {
    const template = makeTemplate();
    template.unit.fields = [];
    const result = validateTemplate(template);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/daily activity/);
  });

  it('rejects duplicate field keys', () => {
    const template = makeTemplate();
    template.unit.fields.push({ ...template.unit.fields[0]!, key: 'activity_0' });
    const result = validateTemplate(template);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Duplicate/);
  });

  it('never allows signature or supervisor fields to be filled', () => {
    const template = makeTemplate();
    template.unit.fields.push({
      key: 'sig',
      type: 'signature',
      page: 0,
      rect: { x: 0.1, y: 0.9, w: 0.3, h: 0.05 },
      fontSize: { min: 8, max: 10 },
      fill: true,
    });
    const result = validateTemplate(template);
    expect(result.ok).toBe(false);
    expect(result.errors.join(' ')).toMatch(/never be filled/);
  });

  it('rejects boxes outside the page', () => {
    const template = makeTemplate();
    template.unit.fields[0]!.rect = { x: 0.8, y: 0.2, w: 0.5, h: 0.1 };
    expect(validateTemplate(template).ok).toBe(false);
  });

  it('rejects a page pointer outside the unit', () => {
    const template = makeTemplate();
    template.unit.fields[0]!.page = 3;
    expect(validateTemplate(template).ok).toBe(false);
  });
});

describe('fingerprints', () => {
  it('normalises page sizes', () => {
    expect(pageSizeKey(595.28, 841.89)).toBe('595x842');
    expect(pageSizeMatches('595x842', '595x842')).toBe(true);
    expect(pageSizeMatches('595x842', '596x843')).toBe(true);
    expect(pageSizeMatches('595x842', '842x595')).toBe(true);
    expect(pageSizeMatches('595x842', '612x792')).toBe(false);
  });

  it('counts differing bits', () => {
    expect(hammingDistance('0000000000000000', '0000000000000000')).toBe(0);
    expect(hammingDistance('0000000000000000', 'ffffffffffffffff')).toBe(64);
    expect(hammingDistance('0000000000000001', '0000000000000000')).toBe(1);
  });

  it('scores identical fingerprints as 1', () => {
    expect(fingerprintSimilarity(['abcdef0123456789'], ['abcdef0123456789'])).toBe(1);
    expect(fingerprintSimilarity(['0000000000000000'], ['ffffffffffffffff'])).toBe(0);
    expect(fingerprintSimilarity([], [])).toBe(0);
  });
});
