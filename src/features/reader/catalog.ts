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
const MANIFEST_CACHE = '__library_manifest__';

/** Load the curated free-license reading catalog once. */
export function loadCatalog({
  strict = false,
}: { strict?: boolean } = {}): Promise<CatalogEntry[]> {
  if (!catalogPromise) {
    const url = `${import.meta.env.BASE_URL}reader/catalog.json`;
    catalogPromise = fetch(url)
      .then((r) => {
        if (!r.ok) throw new Error('catalog-unavailable');
        return r.json();
      })
      .then(async (data: { books: CatalogEntry[] }) => {
        if (!Array.isArray(data.books)) throw new Error('catalog-invalid');
        await db.catalogCache
          .put({ id: MANIFEST_CACHE, book: data.books, cachedAt: Date.now() })
          .catch(() => undefined);
        return data.books;
      })
      .catch(async (error) => {
        const cached = await db.catalogCache
          .get(MANIFEST_CACHE)
          .catch(() => undefined);
        if (cached && Array.isArray(cached.book))
          return cached.book as CatalogEntry[];
        throw error;
      });
    void catalogPromise.catch(() => {
      catalogPromise = null;
    });
  }
  return strict ? catalogPromise : catalogPromise.catch(() => []);
}

export function getCatalogEntry(id: string): Promise<CatalogEntry | undefined> {
  return loadCatalog().then((books) => books.find((b) => b.id === id));
}

/** Resolve a catalog entry to a readable book: shipped JSON for bundled, live fetch for remote. */
export async function openCatalogBook(
  entry: CatalogEntry
): Promise<ParsedBook> {
  const book = await resolveCatalogBook(entry);
  void track('book_open', { source: 'catalog', level: entry.level });
  return book;
}

async function resolveCatalogBook(entry: CatalogEntry): Promise<ParsedBook> {
  try {
    const hit = await db.catalogCache.get(entry.id);
    if (hit) return hit.book as ParsedBook;
  } catch {
    // Reading still works online when the cache is unavailable.
  }
  if (entry.kind === 'bundled' && entry.path) {
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
    if (!res.ok) throw new Error('catalog-book-unavailable');
    const book = (await res.json()) as ParsedBook;
    await db.catalogCache
      .put({ id: entry.id, book, cachedAt: Date.now() })
      .catch(() => undefined);
    return book;
  }
  if (entry.kind === 'remote' && entry.mdUrl) {
    try {
      const hit = await db.catalogCache.get(entry.id);
      if (hit) return hit.book as ParsedBook;
    } catch {
      // cache unavailable — fall through to network
    }
    const res = await fetch(entry.mdUrl);
    if (!res.ok) throw new Error('catalog-book-unavailable');
    const md = await res.text();
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

const LEVEL_ORDER = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Narrow-reading picks: same author first, then closest level. Compounds vocab repetition
 *  (Krashen, "Narrow Reading") — reading more of one author/level recycles the same words. */
export function relatedCatalog(
  entries: CatalogEntry[],
  current: CatalogEntry,
  limit = 4
): CatalogEntry[] {
  const author = current.author?.trim().toLowerCase();
  const lvl = LEVEL_ORDER.indexOf(current.level);
  return entries
    .filter((e) => e.id !== current.id)
    .map((e) => {
      const sameAuthor =
        author && e.author?.trim().toLowerCase() === author ? 1 : 0;
      const levelGap = Math.abs(LEVEL_ORDER.indexOf(e.level) - lvl);
      return { e, sameAuthor, levelGap };
    })
    .sort(
      (a, b) =>
        b.sameAuthor - a.sameAuthor ||
        a.levelGap - b.levelGap ||
        a.e.title.localeCompare(b.e.title)
    )
    .slice(0, limit)
    .map((x) => x.e);
}

/** Ids of remote catalog books already downloaded — the shelf marks these available offline. */
export async function cachedCatalogIds(): Promise<Set<string>> {
  try {
    return new Set((await db.catalogCache.toArray()).map((e) => e.id));
  } catch {
    return new Set();
  }
}
