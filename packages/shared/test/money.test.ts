import { describe, expect, it } from 'vitest';
import {
  BONUS_BRACKETS,
  PACKS,
  bonusForNaira,
  creditsForCustomNaira,
  creditsForWeeks,
  defaultPricing,
  formatNaira,
  packById,
  tierForWeeks,
  validateCustomNaira,
} from '../src/index.js';

describe('pack pricing', () => {
  it('matches PROJECT.md exactly', () => {
    expect(PACKS.map((pack) => [pack.naira, pack.credits])).toEqual([
      [1000, 100],
      [2000, 210],
      [3000, 330],
      [5000, 575],
      [10000, 1200],
    ]);
  });

  it('finds packs by id and rejects unknown ids', () => {
    expect(packById('pack_5000')?.credits).toBe(575);
    expect(packById('pack_nope')).toBeUndefined();
  });
});

describe('custom amount', () => {
  it('applies the documented bonus brackets', () => {
    expect(bonusForNaira(1000)).toBe(0);
    expect(bonusForNaira(1999)).toBe(0);
    expect(bonusForNaira(2000)).toBe(0.05);
    expect(bonusForNaira(3000)).toBe(0.1);
    expect(bonusForNaira(5000)).toBe(0.15);
    expect(bonusForNaira(10000)).toBe(0.2);
    expect(BONUS_BRACKETS.length).toBe(5);
  });

  it('computes floor(naira / 10 x (1 + bonus))', () => {
    expect(creditsForCustomNaira(1000)).toBe(100);
    expect(creditsForCustomNaira(2000)).toBe(210);
    expect(creditsForCustomNaira(3000)).toBe(330);
    expect(creditsForCustomNaira(5000)).toBe(575);
    expect(creditsForCustomNaira(10000)).toBe(1200);
    expect(creditsForCustomNaira(1500)).toBe(150);
    expect(creditsForCustomNaira(2500)).toBe(Math.floor((2500 / 10) * 1.05));
  });

  it('validates range and step', () => {
    expect(validateCustomNaira(500)).toMatch(/Minimum/);
    expect(validateCustomNaira(60000)).toMatch(/Maximum/);
    expect(validateCustomNaira(1050)).toMatch(/steps/);
    expect(validateCustomNaira(2500)).toBeNull();
  });
});

describe('logbook size tiers', () => {
  it('charges flat by number of weeks', () => {
    expect(creditsForWeeks(1)).toBe(100);
    expect(creditsForWeeks(8)).toBe(100);
    expect(creditsForWeeks(9)).toBe(180);
    expect(creditsForWeeks(16)).toBe(180);
    expect(creditsForWeeks(17)).toBe(250);
    expect(creditsForWeeks(26)).toBe(250);
    expect(creditsForWeeks(27)).toBe(350);
    expect(creditsForWeeks(52)).toBe(350);
    expect(tierForWeeks(3).credits).toBe(100);
    expect(tierForWeeks(999).credits).toBe(350);
  });

  it('uses admin overrides', () => {
    const config = defaultPricing();
    config.sizeTiers = [{ maxWeeks: 4, credits: 50 }];
    expect(creditsForWeeks(4, config.sizeTiers)).toBe(50);
    expect(creditsForWeeks(20, config.sizeTiers)).toBe(50);
  });
});

describe('formatting', () => {
  it('formats naira with a thousands separator', () => {
    expect(formatNaira(1000)).toBe('\u20a61,000');
    expect(formatNaira(12345.6)).toBe('\u20a612,346');
  });
});
