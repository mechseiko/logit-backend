import type { DetailLevel, Programme, ReportFacts, ReportOutput, TaskItem } from '@logit/shared';

export interface WeekInput {
  weekNumber: number;
  programme: Programme;
  department: string;
  company: string;
  unit: string;
  tasks: TaskItem[];
  tools: string[];
  skills: string[];
  dates: { date: string; dayName: string }[];
  detail: DetailLevel;
  /** Character budget for each day entry, derived from the template or copy sheet. */
  maxCharsPerEntry: number;
  previousSummary?: string;
  weeklyHighlights?: string;
}

export interface WeekOutput {
  weekNumber: number;
  days: { date: string; entry: string; basedOn: string[] }[];
  weeklySummary?: string;
}

export interface SafeContext {
  programme: string;
  department: string;
  company: string;
  unit: string;
  tasks: TaskItem[];
  tools: string[];
  skills: string[];
  recentEntries: string[];
  detail: DetailLevel;
}

export interface AiProvider {
  readonly name: string;
  generateWeek(input: WeekInput): Promise<WeekOutput>;
  generateReport(input: ReportFacts): Promise<ReportOutput>;
  shorten(input: { text: string; maxChars: number }): Promise<string>;
  chat(input: { context: SafeContext; message: string }): Promise<string>;
}
