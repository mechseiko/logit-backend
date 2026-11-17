import { redact, type ReportFacts, type ReportOutput } from '@logit/shared';
import { ApiError } from '../../errors.js';
import type { AiProvider, WeekInput, WeekOutput } from './types.js';
import { validateReportOutput, validateWeekOutput } from './validate.js';

export interface GenerateWeekOptions {
  provider: AiProvider;
  input: WeekInput;
  studentName?: string;
  matricNo?: string;
  attempts?: number;
}

export interface GeneratedWeek {
  output: WeekOutput;
  removed: string[];
}

/** Redacts PII, calls the provider, validates hard, retries, then fits the text. */
export async function generateValidatedWeek(options: GenerateWeekOptions): Promise<GeneratedWeek> {
  const { provider, input, studentName, matricNo } = options;
  const attempts = Math.max(1, options.attempts ?? 3);
  const removed = new Set<string>();

  const redactedText = (value: string): string => {
    const result = redact(value, { fullName: studentName, matricNo });
    result.removed.forEach((item) => removed.add(item));
    return result.clean;
  };

  const safeInput: WeekInput = {
    ...input,
    company: redactedText(input.company),
    unit: redactedText(input.unit),
    tasks: input.tasks.map((task) => ({ ...task, text: redactedText(task.text) })),
    tools: input.tools.map(redactedText),
    skills: input.skills.map(redactedText),
    weeklyHighlights: input.weeklyHighlights ? redactedText(input.weeklyHighlights) : undefined,
    previousSummary: input.previousSummary ? redactedText(input.previousSummary) : undefined,
  };

  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let raw: unknown;
    try {
      raw = await provider.generateWeek(safeInput);
    } catch (error) {
      lastIssues = [error instanceof Error ? error.message : 'provider error'];
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        continue;
      }
      throw new ApiError(502, 'AI_UNAVAILABLE', 'The writing service is unavailable. Try again.');
    }
    const validation = validateWeekOutput(raw, input);
    if (validation.ok && validation.value) {
      const output = validation.value;
      output.days = output.days
        .map((day) => ({ ...day, entry: day.entry.replace(/\s+/g, ' ').trim() }))
        .sort((a, b) => a.date.localeCompare(b.date));
      // Last-resort fit: ask the provider to shorten anything still over budget.
      for (const day of output.days) {
        if (day.entry.length > input.maxCharsPerEntry) {
          try {
            const shortened = await provider.shorten({
              text: day.entry,
              maxChars: input.maxCharsPerEntry,
            });
            if (shortened.length > 0 && shortened.length < day.entry.length) day.entry = shortened;
          } catch {
            // Keep the original; export will truncate and flag the overflow.
          }
        }
      }
      return { output, removed: [...removed] };
    }
    lastIssues = validation.issues;
  }

  throw new ApiError(502, 'AI_UNAVAILABLE', `The writing service returned unusable entries. ${lastIssues[0] ?? ''}`.trim());
}

export interface GenerateReportOptions {
  provider: AiProvider;
  input: ReportFacts;
  studentName?: string;
  matricNo?: string;
  attempts?: number;
}

export interface GeneratedReport {
  output: ReportOutput;
  removed: string[];
}

/** Same contract as weeks: redact PII, call the provider, validate hard, retry. */
export async function generateValidatedReport(options: GenerateReportOptions): Promise<GeneratedReport> {
  const { provider, input, studentName, matricNo } = options;
  const attempts = Math.max(1, options.attempts ?? 3);
  const removed = new Set<string>();

  const redactedText = (value: string): string => {
    const result = redact(value, { fullName: studentName, matricNo });
    result.removed.forEach((item) => removed.add(item));
    return result.clean;
  };

  const safeInput: ReportFacts = {
    ...input,
    title: redactedText(input.title),
    course: input.course ? redactedText(input.course) : undefined,
    institution: input.institution ? redactedText(input.institution) : undefined,
    objectives: redactedText(input.objectives),
    activities: redactedText(input.activities),
    tools: redactedText(input.tools),
    outcomes: redactedText(input.outcomes),
  };

  let lastIssues: string[] = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    let raw: unknown;
    try {
      raw = await provider.generateReport(safeInput);
    } catch (error) {
      lastIssues = [error instanceof Error ? error.message : 'provider error'];
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
        continue;
      }
      throw new ApiError(502, 'AI_UNAVAILABLE', 'The writing service is unavailable. Try again.');
    }
    const validation = validateReportOutput(raw, safeInput);
    if (validation.ok && validation.value) {
      return { output: validation.value, removed: [...removed] };
    }
    lastIssues = validation.issues;
  }

  throw new ApiError(502, 'AI_UNAVAILABLE', `The writing service returned an unusable report. ${lastIssues[0] ?? ''}`.trim());
}
