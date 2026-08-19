import { db } from '@/db/db';
import { track } from '@/features/analytics/analytics';
import type { ParsedBook } from './parse';
import { parseStorybookMd } from './parse/storybook';

export type CatalogEntry = {
  id: string;
  title: string;
  author?: string;
  level: string;
  license: { type: string; attribution: string; sourceUrl: string };
  kind: 'bundled' | 'remote';
  path?: string; // bundled: shipped reader JSON under public/
  mdUrl?: string; // remote: CORS-open source to fetch on demand
};

let catalogPromise: Promise<CatalogEntry[]> | null = null;

/** Load the curated free-license reading catalog once. */
export function loadCatalog(): Promise<CatalogEntry[]> {
  if (!catalogPromise) {
    const url = `${import.meta.env.BASE_URL}reader/catalog.json`;
    catalogPromise = fetch(url)
      .then((r) => r.json())
      .then((data: { books: CatalogEntry[] }) => data.books)
      .catch(() => []);
  }
  return catalogPromise;
}

export function getCatalogEntry(id: string): Promise<CatalogEntry | undefined> {
  return loadCatalog().then((books) => books.find((b) => b.id === id));
}

/** Resolve a catalog entry to a readable book: shipped JSON for bundled, live fetch for remote. */
export async function openCatalogBook(entry: CatalogEntry): Promise<ParsedBook> {
  const book = await resolveCatalogBook(entry);
  void track('book_open', { source: 'catalog', level: entry.level });
  return book;
}

async function resolveCatalogBook(entry: CatalogEntry): Promise<ParsedBook> {
  if (entry.kind === 'bundled' && entry.path) {
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
    return res.json();
  }
  if (entry.kind === 'remote' && entry.mdUrl) {
    try {
      const hit = await db.catalogCache.get(entry.id);
      if (hit) return hit.book as ParsedBook;
    } catch {
      // cache unavailable — fall through to network
    }
    const md = await (await fetch(entry.mdUrl)).text();
    const book = parseStorybookMd(md, entry.title);
    try {
      await db.catalogCache.put({ id: entry.id, book, cachedAt: Date.now() });
    } catch {
      // best-effort cache
    }
    return book;
  }
  throw new Error('catalog entry has no source');
}

/** Ids of remote catalog books already downloaded — the shelf marks these available offline. */
export async function cachedCatalogIds(): Promise<Set<string>> {
  try {
    return new Set((await db.catalogCache.toArray()).map((e) => e.id));
  } catch {
    return new Set();
  }
}
