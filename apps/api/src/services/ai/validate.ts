import { z } from 'zod';
import { redact, type ReportFacts, type ReportOutput } from '@logit/shared';
import type { WeekInput, WeekOutput } from './types.js';

export const weekOutputSchema = z.object({
  weekNumber: z.number().int(),
  days: z
    .array(
      z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        entry: z.string().trim().min(1).max(6000),
        basedOn: z.array(z.string()).max(8).default([]),
      }),
    )
    .min(1)
    .max(7),
  weeklySummary: z.string().trim().max(2000).optional(),
});

export interface ValidationResult {
  ok: boolean;
  value?: WeekOutput;
  issues: string[];
}

export function validateWeekOutput(raw: unknown, input: WeekInput): ValidationResult {
  const parsed = weekOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const output = parsed.data as WeekOutput;
  const issues: string[] = [];

  if (output.weekNumber !== input.weekNumber) {
    issues.push(`Expected week ${input.weekNumber}, received ${output.weekNumber}.`);
  }

  const expectedDates = new Set(input.dates.map((d) => d.date));
  const seen = new Set<string>();
  for (const day of output.days) {
    if (!expectedDates.has(day.date)) issues.push(`${day.date} is not a working date this week.`);
    if (seen.has(day.date)) issues.push(`${day.date} appears twice.`);
    seen.add(day.date);
  }
  for (const date of expectedDates) {
    if (!seen.has(date)) issues.push(`Missing an entry for ${date}.`);
  }

  const taskIds = new Set(input.tasks.map((task) => task.id));
  const normalizedEntries = new Set<string>();
  for (const day of output.days) {
    if (day.basedOn.length === 0) issues.push(`${day.date} does not reference any task.`);
    for (const id of day.basedOn) {
      if (!taskIds.has(id)) issues.push(`${day.date} references unknown task "${id}".`);
    }
    if (day.entry.length > Math.ceil(input.maxCharsPerEntry * 1.25)) {
      issues.push(`${day.date} is longer than the field allows.`);
    }
    const key = day.entry.toLowerCase().replace(/\s+/g, ' ').trim();
    if (normalizedEntries.has(key)) issues.push(`${day.date} repeats another day word for word.`);
    normalizedEntries.add(key);
    const leaks = redact(day.entry).removed.filter(
      (item) => item === 'a matric-number pattern' || item === 'an email address' || item === 'a phone number',
    );
    if (leaks.length > 0) issues.push(`${day.date} contains personal identifiers.`);
  }

  return issues.length === 0 ? { ok: true, value: output, issues } : { ok: false, issues };
}

export const reportOutputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  sections: z
    .array(
      z.object({
        heading: z.string().trim().min(1).max(160),
        body: z.string().trim().min(1).max(12000),
      }),
    )
    .min(3)
    .max(8),
});

export interface ReportValidationResult {
  ok: boolean;
  value?: ReportOutput;
  issues: string[];
}

export function validateReportOutput(raw: unknown, _input: ReportFacts): ReportValidationResult {
  const parsed = reportOutputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  }
  const output = parsed.data as ReportOutput;
  const issues: string[] = [];

  if (!output.title.trim()) issues.push('The report has no title.');
  const seen = new Set<string>();
  output.sections.forEach((section, index) => {
    const key = section.heading.toLowerCase().replace(/\s+/g, ' ').trim();
    if (seen.has(key)) issues.push(`Section "${section.heading}" appears twice.`);
    seen.add(key);
    const leaks = redact(section.body).removed.filter(
      (item) => item === 'a matric-number pattern' || item === 'an email address' || item === 'a phone number',
    );
    if (leaks.length > 0) issues.push(`Section "${section.heading}" (index ${index}) contains personal identifiers.`);
  });

  return issues.length === 0 ? { ok: true, value: output, issues } : { ok: false, issues };
}
