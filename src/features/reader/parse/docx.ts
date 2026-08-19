import { unzipSync, strFromU8 } from 'fflate';
import type { ParsedBook, Chapter } from './types';
import { normalizeText } from './text';

function paragraphText(p: Element): string {
  let out = '';
  for (const node of Array.from(p.getElementsByTagName('*'))) {
    const local = node.tagName.replace(/^.*:/, '');
    if (local === 't') out += node.textContent ?? '';
    else if (local === 'tab') out += ' ';
    else if (local === 'br' || local === 'cr') out += '\n';
  }
  return out.trim();
}

function isHeading(p: Element): boolean {
  const style = p.getElementsByTagName('*');
  for (const node of Array.from(style)) {
    if (node.tagName.replace(/^.*:/, '') === 'pStyle') {
      const val = node.getAttribute('w:val') ?? node.getAttribute('val') ?? '';
      if (/^heading[12]$/i.test(val) || /^(Заголовок)\s*[12]$/i.test(val)) return true;
    }
  }
  return false;
}

export function parseDocx(bytes: Uint8Array): ParsedBook {
  const files = unzipSync(bytes);
  const docXml = files['word/document.xml'];
  if (!docXml) throw new Error('DOCX: document.xml not found');

  const core = files['docProps/core.xml'] ? strFromU8(files['docProps/core.xml']) : '';
  const title =
    (core && new DOMParser().parseFromString(core, 'application/xml').getElementsByTagName('dc:title')[0]?.textContent?.trim()) ||
    'Untitled';

  const doc = new DOMParser().parseFromString(strFromU8(docXml), 'application/xml');
  const paras = Array.from(doc.getElementsByTagName('*')).filter(
    (el) => el.tagName.replace(/^.*:/, '') === 'p'
  );

  const chapters: Chapter[] = [];
  let buf: string[] = [];
  let heading: string | undefined;
  let idx = 0;
  const flush = () => {
    const text = normalizeText(buf.join('\n\n'));
    if (text.length >= 20) chapters.push({ id: `c${idx++}`, title: heading, text });
    buf = [];
  };
  for (const p of paras) {
    const text = paragraphText(p);
    if (isHeading(p)) {
      if (buf.length) flush();
      heading = text || heading;
      continue;
    }
    if (text) buf.push(text);
  }
  flush();

  if (chapters.length === 0) throw new Error('DOCX: no readable text');
  return { title, author: undefined, chapters };
}
