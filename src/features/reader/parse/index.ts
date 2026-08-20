import { unzipSync, strFromU8 } from 'fflate';
import type { BookFormat, ParsedBook } from './types';
import { parseEpub } from './epub';
import { parseFb2 } from './fb2';
import { parseDocx } from './docx';

export type { BookFormat, ParsedBook, Chapter } from './types';

const EXT: Record<string, BookFormat> = {
  epub: 'epub',
  fb2: 'fb2',
  docx: 'docx',
  pdf: 'pdf',
};

/** Best-effort format from a filename; null for anything we do not read yet (mobi, azw…). */
export function detectFormat(filename: string): BookFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.fb2.zip')) return 'fb2';
  const ext = lower.split('.').pop() ?? '';
  return EXT[ext] ?? null;
}

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK"

/** Decode XML bytes honouring the encoding in the prolog (Russian FB2 is often cp1251). */
function decodeXml(bytes: Uint8Array): string {
  const head = strFromU8(bytes.slice(0, 200)).toLowerCase();
  const m = head.match(/encoding=["']([\w-]+)["']/);
  const label = m?.[1] ?? 'utf-8';
  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    return strFromU8(bytes);
  }
}

export async function parseBook(file: File, format: BookFormat): Promise<ParsedBook> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  switch (format) {
    case 'epub':
      return parseEpub(bytes);
    case 'docx':
      return parseDocx(bytes);
    case 'fb2': {
      if (isZip(bytes)) {
        const files = unzipSync(bytes);
        const name = Object.keys(files).find((k) => k.toLowerCase().endsWith('.fb2'));
        if (!name) throw new Error('FB2: no .fb2 inside archive');
        return parseFb2(decodeXml(files[name]!));
      }
      return parseFb2(decodeXml(bytes));
    }
    case 'pdf': {
      // Lazy-loaded so pdf.js (~1 MB) stays out of the main bundle until a PDF is opened.
      const { parsePdf } = await import('./pdf');
      return parsePdf(bytes);
    }
  }
}
