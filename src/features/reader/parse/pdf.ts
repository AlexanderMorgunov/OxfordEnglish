import * as pdfjs from 'pdfjs-dist';
import PdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?worker';
import type { Chapter, ParsedBook } from './types';
import { reconstruct, type TextItem } from './pdf-reconstruct';
import { normalizeText } from './text';

pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

/** Cap a chapter's length: a heading-less PDF is one long chapter, and ReadingText mounts a
 *  button per word — an unbounded chapter would render tens of thousands of DOM nodes. */
const MAX_CHAPTER_CHARS = 24_000;

function chunkChapters(paragraphs: string[]): Chapter[] {
  const chapters: Chapter[] = [];
  let buf: string[] = [];
  let len = 0;
  let idx = 0;
  const flush = () => {
    if (buf.length === 0) return;
    chapters.push({ id: `c${idx++}`, text: buf.join('\n\n') });
    buf = [];
    len = 0;
  };
  for (const p of paragraphs) {
    if (len > 0 && len + p.length > MAX_CHAPTER_CHARS) flush();
    buf.push(p);
    len += p.length + 2;
  }
  flush();
  return chapters;
}

export async function parsePdf(bytes: Uint8Array): Promise<ParsedBook> {
  const task = pdfjs.getDocument({ data: bytes });
  const doc = await task.promise;
  const meta = await doc.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as { Title?: string; Author?: string };

  const pages: TextItem[][] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const content = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of content.items) {
      if (!('str' in it)) continue; // skip marked-content boundaries
      const t = it.transform as number[];
      items.push({
        str: it.str,
        x: t[4] ?? 0,
        y: t[5] ?? 0,
        width: it.width,
        height: it.height || Math.abs(t[3] ?? 0) || 10,
      });
    }
    pages.push(items);
    page.cleanup();
  }
  await task.destroy();

  const paragraphs = reconstruct(pages)
    .map(normalizeText)
    .filter((p) => p.length > 0);
  const totalChars = paragraphs.reduce((s, p) => s + p.length, 0);
  if (totalChars < 100) throw new Error('pdf-no-text-layer');

  return {
    title: info.Title?.trim() || 'Untitled',
    author: info.Author?.trim() || undefined,
    chapters: chunkChapters(paragraphs),
  };
}
