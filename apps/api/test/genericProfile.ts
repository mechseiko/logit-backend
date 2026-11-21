import type { LogbookProfile } from '@logit/shared';

/**
 * A published profile for tests. Since the engine builds a document from structure rather than
 * drawing into a template, a "layout" in tests is just these numbers.
 */
export function genericProfile(): LogbookProfile {
  return {
    id: 'profile_test_generic',
    name: 'Generic weekly logbook',
    schoolIds: [],
    programmes: ['SIWES', 'SWEP', 'IT'],
    daysPerWeek: 5,
    weeks: 26,
    monthlyEvery: 4,
    title: 'Industrial training logbook',
    labels: {
      weekly: 'Daily record of activities',
      monthly: 'Monthly summary of activities',
      summary: 'Weekly summary',
      supervisor: 'Supervisor’s remark, signature and company stamp',
    },
    status: 'published',
    source: 'admin',
  };
}

export async function seedGenericProfile(store: {
  set(key: string, value: unknown): Promise<unknown>;
}): Promise<void> {
  await store.set('profiles/profile_test_generic', genericProfile());
}
