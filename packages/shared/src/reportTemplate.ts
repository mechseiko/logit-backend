import type { Programme } from './constants.js';

/**
 * A report template is the chapter arc a school's placement report follows. The examples in the
 * owner's reference folder share one: context, theory, what the student did, what went wrong, what
 * they concluded. Headings differ between departments, so a school can word its own chapter titles.
 *
 * `needsSources` is the honest switch: a literature review cites other people's work, so it is only
 * written from a list the student supplies. With no sources, the chapter is omitted, never invented.
 */
export interface ReportTemplateSection {
  key: string;
  /** Chapter number printed in the heading ("1"), or empty for front/back matter. */
  chapter: string;
  heading: string;
  /** Words the section should aim for. A budget, not a promise. */
  words: number;
  /** Written in the student's voice; the model may only use their facts. */
  generated: boolean;
  /** Only written when the student supplies sources for it. */
  needsSources?: boolean;
  /** Short instruction for the model, not shown to the student. */
  guidance: string;
}

export interface ReportTemplate {
  id: string;
  name: string;
  schoolIds: string[];
  programmes: Programme[];
  title: string;
  sections: ReportTemplateSection[];
  status: 'published' | 'draft';
  source: 'builtin' | 'admin';
}

const CHAPTERS: ReportTemplateSection[] = [
  {
    key: 'introduction',
    chapter: '1',
    heading: 'Introduction',
    words: 900,
    generated: true,
    guidance:
      'Background of SIWES and why the student went on attachment; what the company does; the aim and scope of this report. Use only the student facts.',
  },
  {
    key: 'literature',
    chapter: '2',
    heading: 'Literature Review',
    words: 900,
    generated: true,
    needsSources: true,
    guidance:
      'Write only from the sources the student listed. Never add a source, an author, a year or a finding that is not in their list. If the list is empty, emit an empty body.',
  },
  {
    key: 'experience',
    chapter: '3',
    heading: 'Technical Experiences and Skills Acquired',
    words: 1200,
    generated: true,
    guidance:
      'The work the student actually did, grouped by task or tool, in the order they described it. Past tense, first person.',
  },
  {
    key: 'problems',
    chapter: '4',
    heading: 'Technical Problems Encountered and Solutions',
    words: 600,
    generated: true,
    guidance:
      'Only problems the student described, and only the solutions they used. If they described none, say plainly that no significant problem was recorded.',
  },
  {
    key: 'conclusion',
    chapter: '5',
    heading: 'Conclusions and Recommendations',
    words: 600,
    generated: true,
    guidance:
      'Conclusions drawn from chapters one to four, in the student’s voice, then recommendations for the company and the school.',
  },
];

export const OAU_IT_REPORT: ReportTemplate = {
  id: 'report_oau_it',
  name: 'OAU IT report',
  schoolIds: ['oau'],
  programmes: ['SIWES', 'SWEP', 'IT'],
  title: 'Students Industrial Work Experience Scheme Report',
  sections: CHAPTERS,
  status: 'published',
  source: 'builtin',
};

export const BUILTIN_REPORT_TEMPLATES: ReportTemplate[] = [OAU_IT_REPORT];

export function reportTemplateFor(
  templates: ReportTemplate[],
  schoolId: string | undefined,
  programme: Programme,
): ReportTemplate {
  const published = templates.filter((entry) => entry.status === 'published');
  return (
    published.find(
      (entry) => entry.schoolIds.includes(schoolId ?? '') && entry.programmes.includes(programme),
    ) ??
    published[0] ??
    OAU_IT_REPORT
  );
}

/** Total words the template aims for, used for the honest "about N pages" line. */
export function templateWordBudget(template: ReportTemplate): number {
  return template.sections.reduce((total, section) => total + section.words, 0);
}
