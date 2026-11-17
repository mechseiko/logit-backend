import { z } from 'zod';
import { CONSENT_VERSION, DETAIL_LEVELS, PROGRAMMES } from './constants.js';
import { isIsoDate } from './calendar.js';

export const dateString = z.string().refine(isIsoDate, 'Use a date in YYYY-MM-DD form.');

export const programmeSchema = z.enum(PROGRAMMES);
export const levelSchema = z.enum(['100', '200', '300', '400', '500', '600']);

export const bootstrapSchema = z.object({
  referralCode: z.string().trim().max(32).optional(),
});

export const onboardingSchema = z
  .object({
    schoolId: z.string().trim().min(1).optional(),
    otherSchoolName: z.string().trim().min(2).max(120).optional(),
    department: z.string().trim().min(2).max(120),
    programme: programmeSchema,
    level: levelSchema,
    consent: z.object({
      version: z.string().min(1),
      over18: z.literal(true),
    }),
  })
  .refine((v) => Boolean(v.schoolId) !== Boolean(v.otherSchoolName), {
    message: 'Choose a school or type a new one.',
    path: ['schoolId'],
  });

export type OnboardingInput = z.infer<typeof onboardingSchema>;

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(80).optional(),
  department: z.string().trim().min(2).max(120).optional(),
  level: levelSchema.optional(),
  programme: programmeSchema.optional(),
  schoolId: z.string().trim().optional(),
});

export const presignSchema = z.object({
  kind: z.enum(['pdf', 'images']),
  files: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(200),
        type: z.string().trim().min(1).max(100),
        size: z.number().int().min(1),
      }),
    )
    .min(1)
    .max(60),
});

export type PresignInput = z.infer<typeof presignSchema>;

export const submitSchema = z.object({
  orderedKeys: z.array(z.string().min(1).max(300)).min(1).max(60),
});

export const selectTemplateSchema = z.object({ templateId: z.string().min(1).nullable() });
export const requestTemplateSchema = z.object({ consent: z.literal(true) });
export const modeSchema = z.object({ mode: z.literal('copysheet') });

export const taskInputSchema = z.object({ text: z.string().trim().min(3).max(300) });

export const intakeSchema = z
  .object({
    company: z.string().trim().min(2).max(120),
    unit: z.string().trim().max(120).default(''),
    startDate: dateString,
    endDate: dateString,
    workingDays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    holidays: z.array(dateString).max(80).default([]),
    extraDaysOff: z.array(dateString).max(80).default([]),
    tasks: z.array(taskInputSchema).min(3).max(20),
    tools: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
    detail: z.enum(DETAIL_LEVELS),
    weeklyHighlights: z.string().trim().max(2000).optional(),
    linesPerDay: z.number().int().min(3).max(20).optional(),
    charsPerLine: z.number().int().min(40).max(120).optional(),
  })
  .superRefine((value, ctx) => {
    if (value.endDate <= value.startDate) {
      ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'End date must be after the start date.' });
    }
    if (new Set(value.workingDays).size !== value.workingDays.length) {
      ctx.addIssue({ code: 'custom', path: ['workingDays'], message: 'Working days must be unique.' });
    }
    if (value.workingDays.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['workingDays'], message: 'Pick at least one working day.' });
    }
  });

export type IntakeInput = z.infer<typeof intakeSchema>;

export const intakeWithDetailsSchema = z.object({
  intake: intakeSchema,
  studentDetails: z.record(z.string().max(200)).optional(),
});

export const weekUpdateSchema = z.object({
  days: z
    .array(
      z.object({
        date: dateString,
        entry: z.string().trim().min(1).max(4000),
      }),
    )
    .min(1)
    .max(7),
  weeklySummary: z.string().trim().max(4000).optional(),
});

export const chatSchema = z.object({ message: z.string().trim().min(1).max(1000) });

export const paymentInitializeSchema = z
  .object({
    packId: z.string().trim().min(1).optional(),
    customNaira: z.number().int().min(1).max(1_000_000).optional(),
  })
  .refine((v) => Boolean(v.packId) !== Boolean(v.customNaira), {
    message: 'Choose a pack or a custom amount.',
    path: ['packId'],
  });

export const adminAdjustSchema = z.object({
  amount: z.number().int().min(-100000).max(100000).refine((n) => n !== 0, 'Amount cannot be zero.'),
  reason: z.string().trim().min(3).max(300),
});

export const adminBanSchema = z.object({
  banned: z.boolean(),
  reason: z.string().trim().min(3).max(300),
});

export const schoolUpsertSchema = z.object({
  name: z.string().trim().min(2).max(160),
  shortName: z.string().trim().min(2).max(60),
  state: z.string().trim().min(2).max(60),
  type: z.enum(['university', 'polytechnic', 'college']),
  aliases: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  active: z.boolean().default(true),
});

export const schoolRequestSchema = z.object({ name: z.string().trim().min(2).max(160) });

export const resolveTemplateRequestSchema = z.union([
  z.object({ templateId: z.string().min(1) }),
  z.object({ reject: z.literal(true) }),
]);

export const pricingUpdateSchema = z.object({
  packs: z
    .array(z.object({ id: z.string().min(1), naira: z.number().int().min(1), credits: z.number().int().min(1) }))
    .min(1)
    .max(10),
  bonusBrackets: z
    .array(z.object({ minNaira: z.number().int().min(0), bonus: z.number().min(0).max(1) }))
    .min(1)
    .max(10),
  sizeTiers: z
    .array(z.object({ maxWeeks: z.number().int().min(1), credits: z.number().int().min(1) }))
    .min(1)
    .max(10),
  regenCost: z.number().int().min(0).max(100),
  chatFreeMessages: z.number().int().min(0).max(1000),
  chatCost: z.number().int().min(0).max(100),
  reportCost: z.number().int().min(0).max(100),
  referral: z.object({
    referrerCredits: z.number().int().min(0).max(1000),
    friendCredits: z.number().int().min(0).max(1000),
    minNaira: z.number().int().min(0),
    capPerReferrer: z.number().int().min(0).max(10000),
  }),
  limits: z.record(z.number()).optional(),
});

export { CONSENT_VERSION };

export const reportGenerateSchema = z.object({
  title: z.string().trim().min(3).max(160),
  course: z.string().trim().max(160).optional(),
  institution: z.string().trim().max(160).optional(),
  durationWeeks: z.number().int().min(1).max(104).optional(),
  objectives: z.string().trim().min(10).max(4000),
  activities: z.string().trim().min(10).max(8000),
  tools: z.string().trim().max(2000).default(''),
  outcomes: z.string().trim().min(10).max(4000),
});
export type ReportGenerateInput = z.infer<typeof reportGenerateSchema>;
