import { unzipSync, strFromU8 } from 'fflate';
import type { ParsedBook, Chapter } from './types';
import { htmlToText } from './text';

function xml(str: string): Document {
  return new DOMParser().parseFromString(str, 'application/xml');
}

const byLocal = (root: Document | Element, local: string): Element[] =>
  Array.from(root.getElementsByTagNameNS('*', local));

/** Resolve an OPF-relative href against the OPF file's own directory, zip-style. */
function resolve(base: string, href: string): string {
  const parts = base.split('/').slice(0, -1);
  for (const seg of decodeURIComponent(href).split('/')) {
    if (seg === '.' || seg === '') continue;
    if (seg === '..') parts.pop();
    else parts.push(seg);
  }
  return parts.join('/');
}

export function parseEpub(bytes: Uint8Array): ParsedBook {
  const files = unzipSync(bytes);
  const get = (name: string): string | null => {
    const key = name in files ? name : Object.keys(files).find((k) => k.toLowerCase() === name.toLowerCase());
    return key && files[key] ? strFromU8(files[key]) : null;
  };

  const container = get('META-INF/container.xml');
  const opfPath = container ? byLocal(xml(container), 'rootfile')[0]?.getAttribute('full-path') ?? '' : '';
  const opfRaw = opfPath ? get(opfPath) : null;
  if (!opfRaw) throw new Error('EPUB: package document not found');
  const opf = xml(opfRaw);

  const title = byLocal(opf, 'title')[0]?.textContent?.trim() || 'Untitled';
  const author = byLocal(opf, 'creator')[0]?.textContent?.trim() || undefined;

  const manifest = new Map<string, string>();
  for (const item of byLocal(opf, 'item')) {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  }

  const chapters: Chapter[] = [];
  byLocal(opf, 'itemref').forEach((ref, i) => {
    const href = manifest.get(ref.getAttribute('idref') ?? '');
    if (!href) return;
    const doc = get(resolve(opfPath, href));
    if (!doc) return;
    const text = htmlToText(doc);
    if (text.length < 20) return; // skip covers / empty title pages
    chapters.push({ id: `c${i}`, text });
  });

  if (chapters.length === 0) throw new Error('EPUB: no readable chapters');
  return { title, author, chapters };
}
