import type { Programme } from './constants.js';

/**
 * A logbook profile is the *structure* of a school's logbook, not a drawing of it.
 *
 * The old template model stored pixel boxes and wrote our text into the student's scanned pages.
 * That needed a human to draw every box for every school, and it broke the moment a scan was skewed
 * or a monthly page sat between two weeks. A profile only records what the document must look like:
 * how many days a week, how many weeks, whether there is a monthly summary, and the labels the school
 * uses. The engine then builds a clean, printable PDF from those rules.
 */
export interface LogbookProfile {
  id: string;
  name: string;
  /** Schools this profile applies to. Empty means any school. */
  schoolIds: string[];
  programmes: Programme[];
  /** Monday to Saturday is 6; many polytechnics write Monday to Friday only. */
  daysPerWeek: 5 | 6;
  /** Weeks the document is built for. Longer placements extend the document, never truncate it. */
  weeks: number;
  /** When set, a monthly summary page follows every N weeks. */
  monthlyEvery?: number;
  /** Heading printed on the cover. */
  title: string;
  labels: {
    weekly: string;
    monthly: string;
    summary: string;
    supervisor: string;
  };
  status: 'published' | 'draft';
  source: 'builtin' | 'admin' | 'contribution';
}

const LABELS_OAU = {
  weekly: 'Daily record of activities',
  monthly: 'Monthly summary of activities',
  summary: 'Weekly summary',
  supervisor: 'Supervisor’s remark, signature and company stamp',
};

export const BUILTIN_PROFILES: LogbookProfile[] = [
  {
    id: 'profile_oau_siwes',
    name: 'OAU SIWES logbook',
    schoolIds: ['oau'],
    programmes: ['SIWES', 'SWEP'],
    daysPerWeek: 6,
    weeks: 12,
    monthlyEvery: 4,
    title: 'Students Industrial Work Experience Scheme — Logbook',
    labels: LABELS_OAU,
    status: 'published',
    source: 'builtin',
  },
  {
    id: 'profile_oau_it',
    name: 'OAU IT logbook',
    schoolIds: ['oau'],
    programmes: ['IT'],
    daysPerWeek: 6,
    weeks: 12,
    monthlyEvery: 4,
    title: 'Industrial Training — Logbook',
    labels: LABELS_OAU,
    status: 'published',
    source: 'builtin',
  },
  {
    id: 'profile_general',
    name: 'General logbook',
    schoolIds: [],
    programmes: ['SIWES', 'SWEP', 'IT'],
    daysPerWeek: 5,
    weeks: 12,
    monthlyEvery: 4,
    title: 'Industrial training logbook',
    labels: {
      weekly: 'Daily record of activities',
      monthly: 'Monthly summary of activities',
      summary: 'Weekly summary',
      supervisor: 'Supervisor’s remark, signature and company stamp',
    },
    status: 'published',
    source: 'builtin',
  },
];

/** The profile that fits a school and programme, falling back to the general one. */
export function profileFor(
  profiles: LogbookProfile[],
  schoolId: string | undefined,
  programme: Programme,
): LogbookProfile {
  const published = profiles.filter((entry) => entry.status === 'published');
  const exact = published.find(
    (entry) => entry.schoolIds.includes(schoolId ?? '') && entry.programmes.includes(programme),
  );
  if (exact) return exact;
  const bySchool = published.find((entry) => entry.schoolIds.includes(schoolId ?? ''));
  if (bySchool && bySchool.programmes.includes(programme)) return bySchool;
  const general = published.find((entry) => entry.schoolIds.length === 0 && entry.programmes.includes(programme));
  return general ?? published[published.length - 1]!;
}

export function validateProfile(profile: LogbookProfile): string[] {
  const errors: string[] = [];
  if (!profile.id) errors.push('A profile needs an id.');
  if (!profile.name.trim()) errors.push('A profile needs a name.');
  if (profile.programmes.length === 0) errors.push('Pick at least one programme.');
  if (profile.daysPerWeek !== 5 && profile.daysPerWeek !== 6) errors.push('Days per week must be 5 or 6.');
  if (profile.weeks < 1 || profile.weeks > 52) errors.push('Weeks must be between 1 and 52.');
  if (profile.monthlyEvery && (profile.monthlyEvery < 2 || profile.monthlyEvery > 12)) {
    errors.push('A monthly summary can only follow every 2 to 12 weeks.');
  }
  if (!profile.title.trim()) errors.push('A profile needs a cover title.');
  return errors;
}
