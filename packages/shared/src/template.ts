import { z } from 'zod';
import { PROGRAMMES } from './constants.js';
import type { Programme } from './constants.js';
import type { StudentDetailKey, TemplateStatus } from './types.js';

export const FIELD_TYPES = [
  'date',
  'day_name',
  'week_number',
  'daily_activity',
  'weekly_summary',
  'student_detail',
  'signature',
  'supervisor_remarks',
  'blank',
] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const DETAIL_KEYS: StudentDetailKey[] = [
  'fullName',
  'matricNo',
  'department',
  'level',
  'school',
  'company',
  'unit',
  'programme',
];

export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  date: 'Date',
  day_name: 'Day name',
  week_number: 'Week number',
  daily_activity: 'Daily activity (AI)',
  weekly_summary: 'Weekly summary (AI)',
  student_detail: 'Student detail',
  signature: 'Signature (never filled)',
  supervisor_remarks: 'Supervisor remarks (never filled)',
  blank: 'Blank',
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TemplateField {
  key: string;
  type: FieldType;
  page: number;
  /** Normalised 0..1, top-left origin. */
  rect: Rect;
  dayIndex?: number;
  detailKey?: StudentDetailKey;
  lines?: number;
  align?: 'left' | 'center';
  fontSize: { min: number; max: number };
  fill: boolean;
}

export interface Template {
  id: string;
  name: string;
  schoolIds: string[];
  programmes: Programme[];
  pageSizeKey: string;
  fingerprint: { pageCount?: number; dhash: string[]; headerTextHash?: string };
  unit: {
    pagesPerUnit: number;
    firstEntryPage: number;
    maxUnits: number;
    daysPerUnit: number;
    fields: TemplateField[];
  };
  staticFields: TemplateField[];
  status: TemplateStatus;
  version: number;
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
}

const rectSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
    w: z.number().min(0.001).max(1),
    h: z.number().min(0.001).max(1),
  })
  .refine((r) => r.x + r.w <= 1.0001 && r.y + r.h <= 1.0001, {
    message: 'Box must stay inside the page.',
  });

const fontSizeSchema = z
  .object({ min: z.number().min(4).max(72), max: z.number().min(4).max(72) })
  .refine((f) => f.min <= f.max, { message: 'Minimum font size must not exceed the maximum.' });

export const fieldSchema = z.object({
  key: z.string().trim().min(1).max(60),
  type: z.enum(FIELD_TYPES),
  page: z.number().int().min(0).max(200),
  rect: rectSchema,
  dayIndex: z.number().int().min(0).max(6).optional(),
  detailKey: z.enum(DETAIL_KEYS as [StudentDetailKey, ...StudentDetailKey[]]).optional(),
  lines: z.number().int().min(0).max(40).optional(),
  align: z.enum(['left', 'center']).optional(),
  fontSize: fontSizeSchema,
  fill: z.boolean(),
});

export const templateSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(120),
  schoolIds: z.array(z.string()).max(200),
  programmes: z.array(z.enum(PROGRAMMES)).min(1),
  pageSizeKey: z.string().regex(/^\d+x\d+$/, 'Page size key looks like 595x842.'),
  fingerprint: z.object({
    pageCount: z.number().int().min(1).optional(),
    dhash: z.array(z.string().regex(/^[0-9a-f]{16}$/i)).max(12),
    headerTextHash: z.string().max(120).optional(),
  }),
  unit: z.object({
    pagesPerUnit: z.number().int().min(1).max(20),
    firstEntryPage: z.number().int().min(0).max(200),
    maxUnits: z.number().int().min(1).max(52),
    daysPerUnit: z.number().int().min(1).max(7),
    fields: z.array(fieldSchema).min(1),
  }),
  staticFields: z.array(fieldSchema).max(100),
  status: z.enum(['draft', 'pending_review', 'published']),
  version: z.number().int().min(1),
});

export const templateInputSchema = templateSchema.omit({ id: true, status: true, version: true });

export type TemplateInput = z.infer<typeof templateInputSchema>;

export function validateTemplate(template: Template): { ok: boolean; errors: string[] } {
  const parsed = templateSchema.safeParse(template);
  const errors = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);

  const allFields = [...template.unit.fields, ...template.staticFields];
  const keys = new Set<string>();
  for (const field of allFields) {
    if (keys.has(field.key)) errors.push(`Duplicate field key "${field.key}".`);
    keys.add(field.key);
    if ((field.type === 'signature' || field.type === 'supervisor_remarks') && field.fill) {
      errors.push(`"${field.key}" is a signature/supervisor field and must never be filled.`);
    }
    if (field.type === 'student_detail' && !field.detailKey) {
      errors.push(`"${field.key}" is a student detail field but has no detailKey.`);
    }
    if (field.page >= template.unit.pagesPerUnit && template.unit.fields.includes(field)) {
      errors.push(`"${field.key}" points to page ${field.page} but a unit has ${template.unit.pagesPerUnit} page(s).`);
    }
  }
  if (!template.unit.fields.some((f) => f.type === 'daily_activity')) {
    errors.push('A template needs at least one daily activity field.');
  }
  if (template.unit.firstEntryPage + template.unit.pagesPerUnit * template.unit.maxUnits > 500) {
    errors.push('Unit geometry does not fit in a 500-page document.');
  }
  return { ok: errors.length === 0, errors };
}

export function isFieldFillable(field: TemplateField): boolean {
  return field.fill && field.type !== 'signature' && field.type !== 'supervisor_remarks';
}
