import type { Job } from '@logit/shared';

/** Hard ceiling for a logbook's lifetime, whatever the activity (Privacy Policy says 30 days). */
export const MAX_RETENTION_DAYS = 30;

/**
 * Retention window for a logbook: `retentionDays` after the last activity, but never more than
 * `MAX_RETENTION_DAYS` after creation. Written on every touch so an active student keeps their
 * logbook while an abandoned one still expires.
 */
export function extendedExpiry(
  job: Pick<Job, 'createdAt'>,
  retentionDays: number,
  now: Date = new Date(),
): string {
  const created = new Date(job.createdAt).getTime();
  const cap = (Number.isFinite(created) ? created : now.getTime()) + MAX_RETENTION_DAYS * 86_400_000;
  const next = now.getTime() + retentionDays * 86_400_000;
  return new Date(Math.min(next, cap)).toISOString();
}

/** `lastActivityAt` + `expiresAt` for a job the student just touched. */
export function activityPatch(
  job: Pick<Job, 'createdAt'>,
  retentionDays: number,
  now: Date = new Date(),
): { lastActivityAt: string; expiresAt: string } {
  return {
    lastActivityAt: now.toISOString(),
    expiresAt: extendedExpiry(job, retentionDays, now),
  };
}
