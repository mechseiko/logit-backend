import type { FontFamily } from '@logit/shared';

/**
 * Which typeface a generated document uses. The default is the embedded Noto Sans, which carries
 * every glyph we might meet; Times and Courier are the two standard PDF faces, so a student who wants
 * a traditional report can have one without us shipping another font binary.
 */
export const FONT_CHOICES: Array<{ id: FontFamily; label: string; note: string }> = [
  { id: 'sans', label: 'Sans', note: 'Noto Sans — the default, clean on screen and in print' },
  { id: 'serif', label: 'Serif', note: 'Times — the traditional report face' },
  { id: 'mono', label: 'Mono', note: 'Courier — typewriter look' },
];
