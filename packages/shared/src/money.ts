import {
  BONUS_BRACKETS,
  CREDIT_NAIRA,
  CUSTOM_AMOUNT,
  DEFAULT_PRICING,
  PACKS,
  SIZE_TIERS,
} from './constants.js';
import type { BonusBracket, Pack, SizeTier } from './constants.js';

export interface ReferralConfig {
  referrerCredits: number;
  friendCredits: number;
  minNaira: number;
  capPerReferrer: number;
}

export interface PricingConfig {
  packs: Pack[];
  bonusBrackets: BonusBracket[];
  sizeTiers: SizeTier[];
  regenCost: number;
  chatFreeMessages: number;
  chatCost: number;
  reportCost: number;
  referral: ReferralConfig;
  limits: Record<string, number>;
}

export function defaultPricing(): PricingConfig {
  return structuredClone(DEFAULT_PRICING) as PricingConfig;
}

export function bonusForNaira(naira: number, brackets: BonusBracket[] = BONUS_BRACKETS): number {
  const sorted = [...brackets].sort((a, b) => b.minNaira - a.minNaira);
  for (const bracket of sorted) {
    if (naira >= bracket.minNaira) return bracket.bonus;
  }
  return 0;
}

/** Custom top-up: credits = floor(naira / 10 x (1 + bonus)). Always computed server-side. */
export function creditsForCustomNaira(naira: number, config: PricingConfig = defaultPricing()): number {
  const bonus = bonusForNaira(naira, config.bonusBrackets);
  return Math.floor((naira / CREDIT_NAIRA) * (1 + bonus) + 1e-9);
}

export function validateCustomNaira(naira: number): string | null {
  if (!Number.isInteger(naira)) return 'Enter a whole naira amount.';
  if (naira < CUSTOM_AMOUNT.minNaira) return `Minimum top-up is ${formatNaira(CUSTOM_AMOUNT.minNaira)}.`;
  if (naira > CUSTOM_AMOUNT.maxNaira) return `Maximum top-up is ${formatNaira(CUSTOM_AMOUNT.maxNaira)}.`;
  if (naira % CUSTOM_AMOUNT.stepNaira !== 0)
    return `Amounts go in steps of ${formatNaira(CUSTOM_AMOUNT.stepNaira)}.`;
  return null;
}

export function packById(id: string, packs: Pack[] = PACKS as unknown as Pack[]): Pack | undefined {
  return packs.find((p) => p.id === id);
}

export function tierForWeeks(weeks: number, tiers: SizeTier[] = SIZE_TIERS): SizeTier {
  const sorted = [...tiers].sort((a, b) => a.maxWeeks - b.maxWeeks);
  return sorted.find((t) => weeks <= t.maxWeeks) ?? sorted[sorted.length - 1]!;
}

export function creditsForWeeks(weeks: number, tiers: SizeTier[] = SIZE_TIERS): number {
  return tierForWeeks(Math.max(1, weeks), tiers).credits;
}

export function formatNaira(naira: number): string {
  return `\u20a6${Math.round(naira).toLocaleString('en-NG')}`;
}

export function nairaToKobo(naira: number): number {
  return Math.round(naira * 100);
}

export function koboToNaira(kobo: number): number {
  return kobo / 100;
}

/** The only shape the web app may use for money display. */
export function pricingForDisplay(config: PricingConfig = defaultPricing()) {
  return {
    creditNaira: CREDIT_NAIRA,
    packs: config.packs.map((p) => ({
      ...p,
      label: `${p.credits.toLocaleString('en-NG')} credits`,
      priceLabel: formatNaira(p.naira),
    })),
    custom: { ...CUSTOM_AMOUNT },
    bonusBrackets: [...config.bonusBrackets].sort((a, b) => a.minNaira - b.minNaira),
    sizeTiers: [...config.sizeTiers].sort((a, b) => a.maxWeeks - b.maxWeeks),
    regenCost: config.regenCost,
    chatFreeMessages: config.chatFreeMessages,
    chatCost: config.chatCost,
    reportCost: config.reportCost,
    referral: config.referral,
    limits: config.limits,
  };
}
