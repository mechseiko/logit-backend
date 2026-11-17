import type { JobStatus } from './types.js';

export const ACTIVE_JOB_STATUSES: JobStatus[] = [
  'created',
  'queued',
  'processing',
  'needs_layout_choice',
  'awaiting_template',
  'needs_intake',
  'ready_to_generate',
  'generating',
  'generated',
  'exported',
];

const TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  created: ['queued', 'expired', 'failed'],
  queued: ['processing', 'failed', 'expired'],
  processing: ['needs_layout_choice', 'awaiting_template', 'needs_intake', 'failed'],
  needs_layout_choice: ['needs_intake', 'awaiting_template', 'failed', 'expired'],
  awaiting_template: ['needs_intake', 'failed', 'expired'],
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
  needs_layout_choice: 'Choose layout',
  awaiting_template: 'Layout needed',
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
  needs_layout_choice: 2,
  awaiting_template: 2,
  needs_intake: 3,
  ready_to_generate: 4,
  generating: 5,
  generated: 6,
  exported: 7,
  failed: 1,
  expired: 7,
};

export const JOB_STEPS = ['Upload', 'Analysis', 'Layout', 'Questions', 'Preview', 'Generate', 'Review', 'Download'] as const;

export function isJobActive(status: JobStatus): boolean {
  return ACTIVE_JOB_STATUSES.includes(status) && status !== 'exported';
}

export function isJobBusy(status: JobStatus): boolean {
  return status === 'queued' || status === 'processing' || status === 'generating';
}
