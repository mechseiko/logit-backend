import { describe, expect, it } from 'vitest';
import { MAX_RETENTION_DAYS, activityPatch, extendedExpiry } from '../src/services/retention.js';

describe('retention window', () => {
  const createdAt = '2026-01-01T00:00:00.000Z';

  it('extends the window from the last activity', () => {
    const touched = new Date('2026-01-06T00:00:00.000Z');
    expect(extendedExpiry({ createdAt }, 14, touched)).toBe('2026-01-20T00:00:00.000Z');
  });

  it('never goes past 30 days from creation, however active the student is', () => {
    const touched = new Date('2026-01-28T00:00:00.000Z');
    const expiresAt = extendedExpiry({ createdAt }, 14, touched);
    const cap = new Date(new Date(createdAt).getTime() + MAX_RETENTION_DAYS * 86_400_000).toISOString();
    expect(expiresAt).toBe(cap);
    expect(expiresAt).toBe('2026-01-31T00:00:00.000Z');
  });

  it('does not shorten a window that is already later', () => {
    const touched = new Date('2026-01-02T00:00:00.000Z');
    const patch = activityPatch({ createdAt }, 14, touched);
    expect(patch.lastActivityAt).toBe('2026-01-02T00:00:00.000Z');
    expect(new Date(patch.expiresAt).getTime()).toBeGreaterThan(new Date('2026-01-15T00:00:00.000Z').getTime());
  });
});
