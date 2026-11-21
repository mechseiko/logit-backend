import type { JobStatus } from './types.js';

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  'created',
  'queued',
  'processing',
  'needs_intake',
  'ready_to_generate',
  'generating',
  'generated',
  'exported',
];

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  created: ['queued', 'expired', 'failed'],
  queued: ['processing', 'failed', 'expired'],
  processing: ['needs_intake', 'failed'],
  needs_intake: ['ready_to_generate', 'failed', 'expired'],
  ready_to_generate: ['generating', 'needs_intake', 'failed'],
  generating: ['generated', 'failed'],
  generated: ['exported', 'generating', 'failed', 'expired'],
  exported: ['generated', 'generating', 'expired'],
  failed: ['queued', 'processing', 'generating', 'expired', 'needs_intake'],
  expired: [],
};

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export const STATUS_LABELS: Record<JobStatus, string> = {
  created: 'New',
  queued: 'Queued',
  processing: 'Analysing',
  needs_intake: 'Questions',
  ready_to_generate: 'Ready to generate',
  generating: 'Writing entries',
  generated: 'Ready to review',
  exported: 'Completed',
  failed: 'Failed',
  expired: 'Expired',
};

/** Stepper position for the job page. */
export const STATUS_STEP: Record<JobStatus, number> = {
  created: 0,
  queued: 1,
  processing: 1,
  needs_intake: 2,
  ready_to_generate: 3,
  generating: 4,
  generated: 5,
  exported: 6,
  failed: 1,
  expired: 6,
};

export const JOB_STEPS = ['Upload', 'Analysis', 'Questions', 'Preview', 'Generate', 'Review', 'Download'] as const;

export function isJobActive(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status) && status !== 'exported';
}

export function isJobBusy(status: JobStatus): boolean {
  return status === 'queued' || status === 'processing' || status === 'generating';
}
