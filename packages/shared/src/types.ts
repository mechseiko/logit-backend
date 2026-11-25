import type { DetailLevel, Programme } from './constants.js';

export type ExportKind = 'document' | 'preview';

/** The typeface a generated document is set in. */
export type FontFamily = 'sans' | 'serif' | 'mono';

export type JobStatus =
  | 'created'
  | 'queued'
  | 'processing'
  | 'needs_intake'
  | 'ready_to_generate'
  | 'generating'
  | 'generated'
  | 'exported'
  | 'failed'
  | 'expired';

export const JOB_STATUSES: JobStatus[] = [
  'created',
  'queued',
  'processing',
  'needs_intake',
  'ready_to_generate',
  'generating',
  'generated',
  'exported',
  'failed',
  'expired',
];

export interface TaskItem {
  id: string;
  text: string;
}

export interface IntakeAnswers {
  company: string;
  unit: string;
  startDate: string;
  endDate: string;
  /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
  workingDays: number[];
  /** Dates ticked as public holidays (fixed list and movable ones). */
  holidays: string[];
  /** Any other days off, one-off. */
  extraDaysOff: string[];
  tasks: TaskItem[];
  tools: string[];
  skills: string[];
  detail: DetailLevel;
  weeklyHighlights?: string;
  linesPerDay?: number;
  charsPerLine?: number;
}

export type StudentDetailKey =
  | 'fullName'
  | 'matricNo'
  | 'department'
  | 'level'
  | 'school'
  | 'company'
  | 'unit'
  | 'programme';

export type StudentDetails = Partial<Record<StudentDetailKey, string>>;

export interface DayEntry {
  date: string;
  dayName: string;
  entry: string;
  basedOn: string[];
  edited?: boolean;
}

export interface WeekRecord {
  weekNumber: number;
  startDate: string;
  endDate: string;
  workingDates: string[];
  days: DayEntry[];
  weeklySummary?: string;
  status: 'pending' | 'done' | 'failed';
  regenCount: number;
  updatedAt?: string;
  flags: string[];
}

export interface WeekGroup {
  weekNumber: number;
  startDate: string;
  endDate: string;
  dates: string[];
}

export interface Plan {
  weeks: number;
  workingDates: string[];
  groups: WeekGroup[];
  sizeTier: number;
  cost: number;
  warnings: string[];
}

export interface StoredFile {
  key: string;
  name: string;
  size: number;
  type: string;
}

export interface JobAnalysis {
  textPages: number[];
  hasEmbeddedText: boolean;
  pageCount: number;
  pageSizeKey: string;
  fingerprint: { pageCount: number; pageSizeKey: string; dhash: string[] };
  /** How the page images were produced: real raster (poppler/gs) or placeholder. */
  thumbnailKind: 'raster' | 'placeholder';
  /** True when the pages look like a logbook form: a grid of rows, mostly empty. */
  looksLikeLogbook: boolean;
  /** Days per week the form appears to have (5 or 6), when it could be read. */
  detectedDaysPerWeek?: number;
}

export interface JobNormalized {
  key: string;
  bytes: number;
  pages: number;
  pageWidthPt: number;
  pageHeightPt: number;
}

export interface JobUsage {
  previewsUsed: number;
  chatMessages: number;
  aiCalls: number;
}

export interface JobOutput {
  version: number;
  key: string;
  createdAt: string;
  kind: ExportKind;
}

export interface JobError {
  code: string;
  message: string;
  retryable: boolean;
}

export interface JobQueueState {
  state: 'idle' | 'queued' | 'running' | 'failed';
  kind?: 'ingest' | 'generate';
  attempts: number;
  lockedAt?: string;
  availableAt?: string;
  lastAttemptAt?: string;
}

export interface Job {
  id: string;
  uid: string;
  status: JobStatus;
  title: string;
  programme: Programme;
  schoolId: string;
  schoolName?: string;
  department?: string;
  input: { kind: 'pdf' | 'images'; files: StoredFile[] };
  normalized?: JobNormalized;
  analysis?: JobAnalysis;
  /** Typeface the finished document is set in. */
  fontFamily?: FontFamily;
  /** The school structure used to lay the document out (set at submit). */
  profileId: string;
  intake?: IntakeAnswers;
  /** Server-only: filled into the PDF, never sent to an AI provider. */
  studentDetails?: StudentDetails;
  plan?: Plan;
  /** Increments each time generation is (re)started, so credit ledger ids stay unique. */
  generationAttempt?: number;
  usage: JobUsage;
  outputs: JobOutput[];
  queue: JobQueueState;
  error?: JobError;
  warning?: string;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  expiresAt: string;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  schoolId?: string;
  schoolName?: string;
  department?: string;
  programme?: Programme;
  level?: string;
  onboardingDone: boolean;
  consent?: { version: string; at: string; over18: boolean };
  balance: number;
  reserved: number;
  referralCode: string;
  referredBy?: string;
  banned: boolean;
  /** Server-managed: only ever true for OWNER_ADMIN_EMAIL. */
  admin?: boolean;
  createdAt: string;
  lastActiveAt: string;
  totalPaidNaira: number;
}

export interface LedgerEntry {
  /** Document id. Deterministic for reserve/commit/release, so a retry never double-applies. */
  id?: string;
  uid: string;
  type:
    | 'purchase'
    | 'reserve'
    | 'commit'
    | 'release'
    | 'referral_reward'
    | 'referral_bonus'
    | 'adjustment'
    | 'regen'
    | 'chat'
    | 'report';
  amount: number;
  balanceAfter: number;
  reservedAfter: number;
  ref: string;
  note?: string;
  createdAt: string;
}

export interface PaymentRecord {
  reference: string;
  uid: string;
  naira: number;
  credits: number;
  packId: string;
  status: 'initialized' | 'success' | 'failed';
  provider: string;
  createdAt: string;
  verifiedAt?: string;
  firstPayment: boolean;
  /** Mock provider only: the student pressed "simulate payment". */
  mockPaid?: boolean;
}

export interface School {
  id: string;
  name: string;
  shortName: string;
  aliases: string[];
  state: string;
  type: 'university' | 'polytechnic' | 'college';
  active: boolean;
}

/** What the student says they did — the only facts a report may use. */
export interface ReportFacts {
  title: string;
  course?: string;
  institution?: string;
  durationWeeks?: number;
  company?: string;
  objectives: string;
  activities: string;
  tools: string;
  problems?: string;
  solutions?: string;
  outcomes: string;
  /** One source per line. The only material the literature chapter may use. */
  sources?: string;
}

export interface ReportSection {
  heading: string;
  body: string;
}

export interface ReportOutput {
  title: string;
  sections: ReportSection[];
}
