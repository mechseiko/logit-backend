import type { Template, TemplateField } from '@logit/shared';

function field(
  key: string,
  type: TemplateField['type'],
  page: number,
  x: number,
  y: number,
  w: number,
  h: number,
  extra: Partial<TemplateField> = {},
): TemplateField {
  return {
    key,
    type,
    page,
    rect: { x, y, w, h },
    fontSize: { min: 7, max: 11 },
    fill: true,
    ...extra,
  };
}

/**
 * Test-only published layout so API tests can exercise candidate matching,
 * selection, filling and export without seeding demo data into the app.
 */
export function genericWeeklyTemplate(pagesPerUnit = 1): Template {
  const fields: TemplateField[] = [
    field('week_number', 'week_number', 0, 0.78, 0.06, 0.14, 0.03, { align: 'center' }),
  ];
  for (let i = 0; i < 5; i += 1) {
    const y = 0.14 + i * 0.15;
    fields.push(field(`date_${i}`, 'date', 0, 0.06, y, 0.14, 0.05, { dayIndex: i, align: 'center' }));
    fields.push(field(`day_${i}`, 'day_name', 0, 0.21, y, 0.11, 0.05, { dayIndex: i }));
    fields.push(
      field(`activity_${i}`, 'daily_activity', 0, 0.33, y - 0.02, 0.6, 0.12, {
        dayIndex: i,
        fontSize: { min: 6.5, max: 9 },
        lines: 5,
      }),
    );
  }
  fields.push(field('signature', 'signature', 0, 0.06, 0.9, 0.36, 0.05, { fill: false }));
  fields.push(field('supervisor', 'supervisor_remarks', 0, 0.55, 0.9, 0.36, 0.05, { fill: false }));
  if (pagesPerUnit === 2) {
    fields.push(field('week_summary', 'weekly_summary', 1, 0.1, 0.2, 0.8, 0.3, { fontSize: { min: 7, max: 10 } }));
  }

  const staticFields: TemplateField[] = [
    field('full_name', 'student_detail', 0, 0.2, 0.28, 0.6, 0.035, { detailKey: 'fullName' }),
    field('matric_no', 'student_detail', 0, 0.2, 0.35, 0.6, 0.035, { detailKey: 'matricNo' }),
    field('department', 'student_detail', 0, 0.2, 0.42, 0.6, 0.035, { detailKey: 'department' }),
    field('school', 'student_detail', 0, 0.2, 0.49, 0.6, 0.035, { detailKey: 'school' }),
    field('company', 'student_detail', 0, 0.2, 0.56, 0.6, 0.035, { detailKey: 'company' }),
    field('level', 'student_detail', 0, 0.2, 0.63, 0.2, 0.035, { detailKey: 'level' }),
  ];

  const now = new Date().toISOString();
  return {
    id: 'tpl_test_generic',
    name: 'Generic weekly logbook (1 page per week)',
    schoolIds: [],
    programmes: ['SIWES', 'SWEP', 'IT'],
    pageSizeKey: '595x842',
    fingerprint: { pageCount: 1 + pagesPerUnit, dhash: [] },
    unit: { pagesPerUnit, firstEntryPage: 1, maxUnits: 26, daysPerUnit: 5, fields },
    staticFields,
    status: 'published',
    version: 1,
    createdBy: 'test',
    createdAt: now,
    updatedAt: now,
  };
}

export async function seedGenericTemplate(store: { set(key: string, value: unknown): Promise<unknown> }): Promise<void> {
  await store.set('templates/tpl_test_generic', genericWeeklyTemplate());
}

export function genericTemplateInput(): Omit<Template, 'id' | 'status' | 'version' | 'createdBy' | 'createdAt' | 'updatedAt'> {
  const { id: _id, status: _s, version: _v, createdBy: _c, createdAt: _ca, updatedAt: _u, ...input } =
    genericWeeklyTemplate();
  return input;
}
