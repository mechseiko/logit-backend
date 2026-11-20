import type { Programme } from './constants.js';

/**
 * The five products, in one place.
 *
 * Every surface that names a product — the landing page, the header menu, the app sidebar, the
 * report picker, admin and the legal pages — reads from this list, so they cannot disagree about what
 * exists or what it can do. A product only claims a capability when the engine has it; anything
 * else is `coming_soon` and has no price and no way to start it.
 */

export type ProductId =
  | 'siwes_logbook'
  | 'swep_logbook'
  | 'it_logbook'
  | 'it_report'
  | 'project_report';

export type ProductStatus = 'available' | 'conditional' | 'draft' | 'coming_soon';

export interface ProductCapabilities {
  /** Writes entries into the student's own uploaded pages, when a published layout matches. */
  fillsOwnPages: boolean;
  /** Produces a printable sheet the student copies by hand when no layout matches. */
  copySheet: boolean;
  /** Generates numbered chapters (1–5) rather than a handful of sections. */
  chapters: boolean;
  /** Formats student-supplied references. Never invents them. */
  references: boolean;
  coverPage: boolean;
  toc: boolean;
  docx: boolean;
  /** A server-generated PDF. Browser printing is not this. */
  pdfExport: boolean;
}

export interface Product {
  id: ProductId;
  /** The name shown to students. Nothing stronger than the engine can back. */
  label: string;
  /** Shorter form for menus and chips. */
  shortLabel: string;
  oneLiner: string;
  /** The sentence we are allowed to print. Written to be true today. */
  claim: string;
  status: ProductStatus;
  capabilities: ProductCapabilities;
  /** The programme this product writes for, when it is a logbook. */
  programme?: Programme;
  /** Pricing key. Absent means it cannot be bought. */
  priceKey?: 'logbook' | 'report';
  /** Route that starts the product. Absent for anything not sellable. */
  startPath?: string;
}

const LOGBOOK_CAPS: ProductCapabilities = {
  fillsOwnPages: true,
  copySheet: true,
  chapters: false,
  references: false,
  coverPage: false,
  toc: false,
  docx: false,
  pdfExport: true,
};

const DRAFT_CAPS: ProductCapabilities = {
  fillsOwnPages: false,
  copySheet: false,
  chapters: false,
  references: false,
  coverPage: false,
  toc: false,
  docx: false,
  pdfExport: false,
};

const NOTHING: ProductCapabilities = {
  fillsOwnPages: false,
  copySheet: false,
  chapters: false,
  references: false,
  coverPage: false,
  toc: false,
  docx: false,
  pdfExport: false,
};

export const PRODUCTS: Product[] = [
  {
    id: 'siwes_logbook',
    label: 'SIWES logbook',
    shortLabel: 'SIWES',
    oneLiner: "Weekly entries in your school's pages",
    claim:
      'Weekly entries written from your notes. Fills your school’s pages where we have the layout, otherwise a copy sheet sized to your page.',
    status: 'conditional',
    capabilities: LOGBOOK_CAPS,
    programme: 'SIWES',
    priceKey: 'logbook',
    startPath: '/app/new',
  },
  {
    id: 'swep_logbook',
    label: 'SWEP logbook',
    shortLabel: 'SWEP',
    oneLiner: 'The same pages, SWEP wording',
    claim:
      'The same weekly entries in SWEP wording. Fills your school’s pages where we have the layout, otherwise a copy sheet.',
    status: 'conditional',
    capabilities: LOGBOOK_CAPS,
    programme: 'SWEP',
    priceKey: 'logbook',
    startPath: '/app/new',
  },
  {
    id: 'it_logbook',
    label: 'IT logbook',
    shortLabel: 'IT',
    oneLiner: 'Industrial training, week by week',
    claim:
      'Weekly entries for industrial training. Fills your school’s pages where we have the layout, otherwise a copy sheet.',
    status: 'conditional',
    capabilities: LOGBOOK_CAPS,
    programme: 'IT',
    priceKey: 'logbook',
    startPath: '/app/new',
  },
  {
    id: 'it_report',
    label: 'IT report draft',
    shortLabel: 'IT report draft',
    oneLiner: 'A sectioned draft from your facts',
    claim:
      'A short, sectioned draft written only from the facts you type. You finish the document — it is not a bound report.',
    status: 'draft',
    capabilities: DRAFT_CAPS,
    priceKey: 'report',
    startPath: '/app/reports',
  },
  {
    id: 'project_report',
    label: 'Project report',
    shortLabel: 'Project report',
    oneLiner: 'Chaptered reports are in progress',
    claim:
      'A chaptered project report — abstract, chapters 1–5, references — is being built. Not available yet.',
    status: 'coming_soon',
    capabilities: NOTHING,
  },
];

export const STATUS_LABEL: Record<ProductStatus, string> = {
  available: 'Available',
  conditional: 'Layout-dependent',
  draft: 'Draft',
  coming_soon: 'Coming soon',
};

/** Longer explanation for a tooltip or a detail line. */
export const STATUS_NOTE: Record<ProductStatus, string> = {
  available: 'Works end to end for every school.',
  conditional:
    'Fills your pages where we have a published layout for your school; otherwise you get a copy sheet.',
  draft: 'Generated as editable text for you to finish and submit in your own document.',
  coming_soon: 'Not built yet. No price and no way to start it.',
};

export const productById = (id: ProductId): Product => {
  const product = PRODUCTS.find((entry) => entry.id === id);
  if (!product) throw new Error(`Unknown product: ${id}`);
  return product;
};

/** Anything a student can start today. */
export const isStartable = (product: Product): boolean =>
  product.status !== 'coming_soon' && Boolean(product.startPath);

/** Anything a student can pay for today. */
export const isPurchasable = (product: Product): boolean =>
  product.status !== 'coming_soon' && Boolean(product.priceKey);

/** The logbook products, in menu order. */
export const LOGBOOK_PRODUCTS = PRODUCTS.filter((product) => Boolean(product.programme));

/** Products shown in the report workspace. */
export const REPORT_PRODUCTS = PRODUCTS.filter((product) => !product.programme);

/** True when every capability a claim mentions is actually implemented. */
export function claimMatchesCapabilities(product: Product): boolean {
  const text = `${product.label} ${product.oneLiner} ${product.claim}`.toLowerCase();
  // A coming-soon product may describe what it will be, provided the copy says it is not available.
  if (product.status === 'coming_soon') {
    return /not available|coming soon|being built|in progress/.test(text);
  }
  const required: Array<[RegExp, keyof ProductCapabilities]> = [
    [/\bchapter/, 'chapters'],
    [/\breference/, 'references'],
    [/\bcover page|title page\b/, 'coverPage'],
    [/\btable of contents\b/, 'toc'],
    [/\bdocx|word document\b/, 'docx'],
  ];
  return required.every(([pattern, key]) => !pattern.test(text) || product.capabilities[key]);
}
