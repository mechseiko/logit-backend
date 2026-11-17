import zlib from 'node:zlib';
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFRawStream, PDFStream } from 'pdf-lib';

/**
 * Lightweight embedded-text extraction (no OCR). We only need to know whether a page
 * carries a real text layer and roughly how much, so we decode content streams and
 * collect literal strings from Tj/TJ operators.
 */

function streamData(stream: PDFStream): Buffer | null {
  const dict = stream.dict;
  const filters: string[] = [];
  const filter = dict.get(PDFName.of('Filter'));
  if (filter instanceof PDFName) filters.push(filter.asString().replace('/', ''));
  if (filter instanceof PDFArray) {
    for (let i = 0; i < filter.size(); i += 1) {
      const entry = filter.get(i);
      if (entry instanceof PDFName) filters.push(entry.asString().replace('/', ''));
    }
  }
  const raw = (stream as PDFRawStream).contents;
  if (!raw) return null;
  let data: Buffer = Buffer.from(raw);
  for (const name of filters) {
    if (name === 'FlateDecode') {
      try {
        data = zlib.inflateSync(data);
      } catch {
        try {
          data = zlib.inflateRawSync(data);
        } catch {
          return null;
        }
      }
    } else if (name === 'ASCIIHexDecode') {
      const hex = data.toString('latin1').replace(/>$/, '').replace(/[^0-9a-f]/gi, '');
      data = Buffer.from(hex, 'hex');
    } else {
      // Images and exotic filters hold no text we can read.
      return null;
    }
  }
  return data;
}

function decodePdfLiteral(literal: string): string {
  return literal
    .replace(/\\([nrtbf()\\])/g, (_match, code: string) => {
      const map: Record<string, string> = {
        n: '\n',
        r: '\r',
        t: '\t',
        b: '\b',
        f: '\f',
        '(': '(',
        ')': ')',
        '\\': '\\',
      };
      return map[code] ?? code;
    })
    .replace(/\\([0-7]{1,3})/g, (_match, octal: string) => String.fromCharCode(parseInt(octal, 8)));
}

const LITERAL_RE = /\((?:\\.|[^\\()])*\)/g;

function pageContent(pdf: PDFDocument, pageIndex: number): Buffer[] {
  const page = pdf.getPage(pageIndex);
  const contents = page.node.Contents();
  const streams: PDFStream[] = [];
  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i += 1) {
      const resolved = pdf.context.lookup(contents.get(i));
      if (resolved instanceof PDFStream) streams.push(resolved);
    }
  } else if (contents instanceof PDFStream) {
    streams.push(contents);
  }
  return streams.map(streamData).filter((buffer): buffer is Buffer => buffer !== null);
}

export interface ExtractedPage {
  page: number;
  characters: number;
  sample: string;
}

export async function extractEmbeddedText(pdf: PDFDocument): Promise<ExtractedPage[]> {
  const pages: ExtractedPage[] = [];
  for (let index = 0; index < pdf.getPageCount(); index += 1) {
    let characters = 0;
    let sample = '';
    try {
      for (const data of pageContent(pdf, index)) {
        const source = data.toString('latin1');
        if (!/\b(Tj|TJ)\b/.test(source)) continue;

        for (const literal of source.match(LITERAL_RE) ?? []) {
          const decoded = decodePdfLiteral(literal.slice(1, -1));
          characters += decoded.length;
          if (sample.length < 400) sample += decoded;
        }
        // pdf-lib writes hex strings for embedded fonts; count the bytes they encode.
        for (const hex of source.match(/<[0-9A-Fa-f\s]+>/g) ?? []) {
          characters += Math.floor(hex.replace(/[^0-9A-Fa-f]/g, '').length / 2);
        }
      }
    } catch {
      characters = 0;
    }
    pages.push({
      page: index + 1,
      characters,
      sample: sample.trim().slice(0, 400),
    });
  }
  return pages;
}

export function pdfDictHasKey(dict: PDFDict, key: string): boolean {
  return dict.has(PDFName.of(key));
}
