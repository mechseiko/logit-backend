import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { OAU_IT_REPORT, type ReportFacts } from '@logit/shared';
import { buildReportDocument } from '../src/services/pdf/reportDoc.js';
import { loadFontBytes } from '../src/services/fonts.js';

const facts: ReportFacts = {
  title: 'SIWES report at ZICS Fabrication',
  course: 'Mechanical Engineering',
  institution: 'Obafemi Awolowo University',
  durationWeeks: 8,
  company: 'ZICS Fabrication',
  objectives: 'To learn fabrication practice and CAD.',
  activities: 'Modelled gate frames, prepared laser cut files, assembled a gate frame.',
  tools: 'Autodesk Inventor, SolidWorks, laser cutter',
  problems: 'The first cut drifted because the sheet was not clamped.',
  solutions: 'Clamped the sheet and re-ran the job.',
  outcomes: 'Learned parametric design and shop-floor discipline.',
  sources: 'Smith, J. (2019). Fabrication Practice. Ibadan: Example Press.',
};

const student = {
  name: 'Ada Student',
  matricNo: 'MEE/2022/1234',
  department: 'Mechanical Engineering',
  institution: 'Obafemi Awolowo University',
};

const sections = [
  { heading: 'Abstract', body: 'A short summary of the attachment and what it produced.' },
  { heading: 'Introduction', body: 'Background of SIWES and the company. '.repeat(20) },
  { heading: 'Technical Experiences and Skills Acquired', body: 'I modelled frames. '.repeat(60) },
  { heading: 'Conclusions and Recommendations', body: 'The attachment met its aims. '.repeat(15) },
];

describe('report document', () => {
  it('lays out a title page, front matter, contents and chapters', async () => {
    const fontBytes = await loadFontBytes();
    const { bytes, pages } = await buildReportDocument(
      { template: OAU_IT_REPORT, facts, sections, student },
      fontBytes,
    );

    // title + declaration + certification + contents + body + references
    expect(pages).toBeGreaterThanOrEqual(6);
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBe(pages);
    // Structure: title, declaration, certification, contents, then body.
    expect(pdf.getPages()[3]!.getSize().width).toBeGreaterThan(500);
  });

  it('omits the references page when the student supplied no sources', async () => {
    const fontBytes = await loadFontBytes();
    const withoutSources = { ...facts, sources: '' };
    const withSources = await buildReportDocument(
      { template: OAU_IT_REPORT, facts, sections, student },
      fontBytes,
    );
    const without = await buildReportDocument(
      { template: OAU_IT_REPORT, facts: withoutSources, sections, student },
      fontBytes,
    );
    expect(without.pages).toBeLessThan(withSources.pages);
  });

  it('sets the same report in a serif face and in mono', async () => {
    const fontBytes = await loadFontBytes();
    const sizes: number[] = [];
    for (const fontFamily of ['sans', 'serif', 'mono'] as const) {
      const { bytes, pages } = await buildReportDocument(
        { template: OAU_IT_REPORT, facts, sections, student, fontFamily },
        fontBytes,
      );
      expect(pages).toBeGreaterThanOrEqual(6);
      sizes.push(bytes.byteLength);
    }
    expect(new Set(sizes).size).toBeGreaterThan(1);
  });
});
