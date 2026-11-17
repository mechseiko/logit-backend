/**
 * PII redaction. Runs on every free-text field immediately before an AI call.
 * The student's name, matric number, email and phone must never reach a provider.
 */

export interface RedactOptions {
  fullName?: string;
  matricNo?: string;
  extra?: string[];
}

export interface RedactResult {
  clean: string;
  removed: string[];
}

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
/** Nigerian mobile numbers, local and international form: 0803 123 4567, +2348031234567. */
const PHONE_RE = /(?:\+?234[\s-]?|0)(?:7[01]|8[01]|9[01])[\s-]?\d{3}[\s-]?\d{5}\b/g;
/** Common matric formats: 2021/ET/1234, CSC/2020/1234, 190404021, ENG2019014. */
const MATRIC_PATTERNS = [
  /\b\d{4}\/[A-Z]{2,5}\/\d{2,5}\b/gi,
  /\b[A-Z]{2,5}\/\d{4}\/\d{2,5}\b/gi,
  /\b[A-Z]{2,5}\d{6,}\b/gi,
  /\b\d{8,12}\b/g,
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function nameTokens(fullName?: string): string[] {
  if (!fullName) return [];
  return fullName
    .split(/\s+/)
    .map((token) => token.replace(/[^A-Za-z'-]/g, ''))
    .filter((token) => token.length >= 3);
}

export function redact(text: string, options: RedactOptions = {}): RedactResult {
  if (!text) return { clean: text, removed: [] };
  let clean = text;
  const removed = new Set<string>();

  // Replace the full name first, in any casing.
  if (options.fullName && options.fullName.trim().length >= 3) {
    const words = options.fullName.trim().split(/\s+/).map(escapeRegExp).join('\\s+');
    const re = new RegExp(`\\b${words}\\b`, 'gi');
    if (clean.match(re)) {
      removed.add('your name');
      clean = clean.replace(re, '[NAME]');
    }
  }

  // Then any capitalised token of the name (people rarely type their own name in lower case).
  for (const token of nameTokens(options.fullName)) {
    const re = new RegExp(`\\b${escapeRegExp(token)}\\b`, 'g');
    if (clean.match(re)) {
      removed.add('your name');
      clean = clean.replace(re, '[NAME]');
    }
  }

  if (options.matricNo) {
    const re = new RegExp(`\\b${escapeRegExp(options.matricNo.trim())}\\b`, 'gi');
    if (re.test(clean)) {
      removed.add('your matric number');
      clean = clean.replace(re, '[MATRIC]');
    }
  }

  for (const extra of options.extra ?? []) {
    const value = extra.trim();
    if (value.length < 3) continue;
    const re = new RegExp(`\\b${escapeRegExp(value)}\\b`, 'gi');
    if (re.test(clean)) {
      removed.add('the details you asked to remove');
      clean = clean.replace(re, '[REMOVED]');
    }
  }

  if (clean.match(EMAIL_RE)) {
    removed.add('an email address');
    clean = clean.replace(EMAIL_RE, '[EMAIL]');
  }

  for (const pattern of MATRIC_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    if (re.test(clean)) {
      removed.add('a matric-number pattern');
      clean = clean.replace(re, '[MATRIC]');
    }
  }

  if (clean.match(PHONE_RE)) {
    removed.add('a phone number');
    clean = clean.replace(PHONE_RE, '[PHONE]');
  }

  return { clean, removed: [...removed] };
}

export function containsPii(text: string, options: RedactOptions = {}): boolean {
  return redact(text, options).removed.length > 0;
}
