/**
 * All money, pricing, limits and enums live here.
 * The API is the only place these are enforced; the web app displays values from /api/pricing.
 */

export const APP_NAME = 'LOGIT';
export const APP_DOMAIN = 'uselogit.cv';
export const APP_TAGLINE = 'Your experience. Properly documented.';

/** 1 credit = N10 */
export const CREDIT_NAIRA = 10;

export const PACKS = [
  { id: 'pack_1000', naira: 1000, credits: 100 },
  { id: 'pack_2000', naira: 2000, credits: 210 },
  { id: 'pack_3000', naira: 3000, credits: 330 },
  { id: 'pack_5000', naira: 5000, credits: 575 },
  { id: 'pack_10000', naira: 10000, credits: 1200 },
] as const;

export type Pack = { id: string; naira: number; credits: number };

export type BonusBracket = { minNaira: number; bonus: number };

export const BONUS_BRACKETS: BonusBracket[] = [
  { minNaira: 10000, bonus: 0.2 },
  { minNaira: 5000, bonus: 0.15 },
  { minNaira: 3000, bonus: 0.1 },
  { minNaira: 2000, bonus: 0.05 },
  { minNaira: 0, bonus: 0 },
];

export type SizeTier = { maxWeeks: number; credits: number };

/** Flat cost to generate a logbook, by number of weeks to fill. */
export const SIZE_TIERS: SizeTier[] = [
  { maxWeeks: 8, credits: 100 },
  { maxWeeks: 16, credits: 180 },
  { maxWeeks: 26, credits: 250 },
  { maxWeeks: 9999, credits: 350 },
];

export const CUSTOM_AMOUNT = { minNaira: 1000, maxNaira: 50000, stepNaira: 100 };

export const REFERRAL = {
  referrerCredits: 20,
  friendCredits: 10,
  minNaira: 1000,
  capPerReferrer: 25,
};

export const LIMITS = {
  maxPdfBytes: 20 * 1024 * 1024,
  maxPdfPages: 50,
  maxImages: 60,
  maxImageBytes: 8 * 1024 * 1024,
  maxImagesTotalBytes: 30 * 1024 * 1024,
  maxActiveJobs: 3,
  uploadsPerDay: 5,
  previewsPerUserPerDay: 3,
  previewsPerJob: 1,
  maxPdfOutputBytes: 6 * 1024 * 1024,
  maxPdfHardBytes: 10 * 1024 * 1024,
  jobTimeoutMs: 4 * 60 * 1000,
  regenCost: 5,
  chatFreeMessages: 10,
  chatCost: 1,
  reportCost: 10,
  aiDailyCallsPerUser: 200,
  maxCustomNaira: 50000,
} as const;

export const DEFAULT_PRICING = {
  packs: PACKS.map((p) => ({ ...p })),
  bonusBrackets: BONUS_BRACKETS.map((b) => ({ ...b })),
  sizeTiers: SIZE_TIERS.map((t) => ({ ...t })),
  regenCost: LIMITS.regenCost,
  chatFreeMessages: LIMITS.chatFreeMessages,
  chatCost: LIMITS.chatCost,
  reportCost: LIMITS.reportCost,
  referral: { ...REFERRAL },
  limits: { ...LIMITS },
};

export const PROGRAMMES = ['SIWES', 'SWEP', 'IT'] as const;
export type Programme = (typeof PROGRAMMES)[number];
export const PROGRAMME_LABELS: Record<Programme, string> = {
  SIWES: 'SIWES (Students Industrial Work Experience Scheme)',
  SWEP: 'SWEP (Student Work Experience Programme)',
  IT: 'IT (Industrial Training)',
};

export const LEVELS = ['100', '200', '300', '400', '500', '600'] as const;

export const DETAIL_LEVELS = ['short', 'standard', 'detailed'] as const;
export type DetailLevel = (typeof DETAIL_LEVELS)[number];
export const DETAIL_LEVEL_HINTS: Record<DetailLevel, string> = {
  short: 'Short — one or two sentences per day',
  standard: 'Standard — a few sentences per day',
  detailed: 'Detailed — a full paragraph per day',
};

/** ISO weekday numbers, Monday = 1 ... Sunday = 7. */
export const WORKING_DAY_PRESETS = {
  'Mon-Fri': [1, 2, 3, 4, 5],
  'Mon-Sat': [1, 2, 3, 4, 5, 6],
  'Mon-Sun': [1, 2, 3, 4, 5, 6, 7],
} as const;

export const WEEKDAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/** Fixed Nigerian public holidays the student can tick. Movable ones are ticked manually. */
export const FIXED_HOLIDAYS = [
  { month: 1, day: 1, name: "New Year's Day" },
  { month: 5, day: 1, name: "Workers' Day" },
  { month: 6, day: 12, name: 'Democracy Day' },
  { month: 10, day: 1, name: 'Independence Day' },
  { month: 12, day: 25, name: 'Christmas Day' },
  { month: 12, day: 26, name: 'Boxing Day' },
] as const;

export const MOVABLE_HOLIDAY_HINTS = [
  'Eid al-Fitr',
  'Eid al-Adha',
  'Good Friday',
  'Easter Monday',
  'Eid al-Maulud',
] as const;

export const CONSENT_VERSION = '2026-02-01';

export const RETENTION_DEFAULTS = {
  retentionDays: 14,
  entriesRetentionDays: 180,
  rawRetentionHours: 24,
  templateRequestMaxDays: 30,
  storageGuardWarnRatio: 0.7,
  storageGuardBlockRatio: 0.9,
  storageBudgetBytes: 10 * 1024 * 1024 * 1024,
};

export const ERROR_CODES = [
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'BANNED',
  'VALIDATION',
  'NOT_FOUND',
  'INSUFFICIENT_CREDITS',
  'RATE_LIMITED',
  'LIMIT_REACHED',
  'UNSUPPORTED_FILE',
  'ENCRYPTED_PDF',
  'TOO_LARGE',
  'TOO_MANY_PAGES',
  'PROCESSING_FAILED',
  'AI_UNAVAILABLE',
  'PAYMENT_ERROR',
  'CONFLICT',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Public site details — hardcoded product facts, not configuration. */
export const SITE_URL = 'https://uselogit.cv';
/** One mailbox until the support@ and privacy@ addresses exist. */
export const SUPPORT_EMAIL = 'hello@uselogit.cv';
export const SUPPORT_WHATSAPP = '2348080296575';
export const DPO_EMAIL = 'privacy@uselogit.cv';
export const LEGAL_ENTITY_NAME = 'Logit';
export const LEGAL_ENTITY_ADDRESS = 'Lagos, Nigeria';
