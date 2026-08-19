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
  if (entry.kind === 'bundled' && entry.path) {
    const res = await fetch(`${import.meta.env.BASE_URL}${entry.path}`);
    return res.json();
  }
  if (entry.kind === 'remote' && entry.mdUrl) {
    const md = await (await fetch(entry.mdUrl)).text();
    return parseStorybookMd(md, entry.title);
  }
  throw new Error('catalog entry has no source');
}
