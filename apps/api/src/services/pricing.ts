import type { PricingConfig } from '@logit/shared';
import { defaultPricing, pricingUpdateSchema } from '@logit/shared';
import type { Store } from '../db/index.js';
import { badRequest } from '../errors.js';

const CONFIG_PATH = 'config/pricing';

/** Pricing always comes from Firestore (editable in admin), with shared constants as defaults. */
export async function getPricing(store: Store): Promise<PricingConfig> {
  const defaults = defaultPricing();
  const stored = await store.get<Partial<PricingConfig>>(CONFIG_PATH);
  if (!stored) return defaults;
  return {
    ...defaults,
    ...stored,
    packs: stored.packs?.length ? stored.packs : defaults.packs,
    bonusBrackets: stored.bonusBrackets?.length ? stored.bonusBrackets : defaults.bonusBrackets,
    sizeTiers: stored.sizeTiers?.length ? stored.sizeTiers : defaults.sizeTiers,
    referral: { ...defaults.referral, ...(stored.referral ?? {}) },
    limits: { ...defaults.limits, ...(stored.limits ?? {}) },
  };
}

export async function setPricing(store: Store, input: unknown): Promise<PricingConfig> {
  const parsed = pricingUpdateSchema.safeParse(input);
  if (!parsed.success) {
    throw badRequest('Check the pricing values.', parsed.error.flatten());
  }
  const current = await getPricing(store);
  const next: PricingConfig = {
    ...current,
    ...parsed.data,
    referral: { ...current.referral, ...parsed.data.referral },
    limits: { ...current.limits, ...(parsed.data.limits ?? {}) },
  };
  const sortedTiers = [...next.sizeTiers].sort((a, b) => a.maxWeeks - b.maxWeeks);
  next.sizeTiers = sortedTiers;
  next.bonusBrackets = [...next.bonusBrackets].sort((a, b) => b.minNaira - a.minNaira);
  await store.set(CONFIG_PATH, next);
  return next;
}
