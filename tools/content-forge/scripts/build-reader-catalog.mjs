import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { storybookSearch, storybookFetch } from '../src/lib/storybooks.ts';
import { politeFetch } from '../src/lib/net.ts';
import { stems, tokenize } from '../../../src/features/reader/difficulty.ts';

// Builds the bundled "recommended reading" shelf from Global Storybooks (CC-BY 4.0). The
// per-item license is enforced by storybookFetch (it throws on anything non-redistributable),
// and each book's CEFR level is assigned by OUR difficulty engine, not fragile source metadata.

const OUT_DIR = resolve(process.cwd(), '../../public/reader/catalog');
const MANIFEST = resolve(process.cwd(), '../../public/reader/catalog.json');
const FREQ = resolve(process.cwd(), '../../public/reader/en-freq.json');

const freq = new Map(JSON.parse(readFileSync(FREQ, 'utf8')).words.map((w, i) => [w, i + 1]));

// Level by the vocabulary profile of the in-list words: the 90th-percentile word rank.
// Out-of-list tokens (proper nouns, rare content words) are ignored — they are a flat
// reading tax at every level, so counting them would over-rate short texts.
function levelOf(text) {
  const ranks = tokenize(text)
    .map((t) => Math.min(...stems(t).map((s) => freq.get(s) ?? Infinity)))
    .filter((r) => Number.isFinite(r))
    .sort((a, b) => a - b);
  if (ranks.length < 10) return 'A2';
  const p90 = ranks[Math.floor(ranks.length * 0.9)];
  return p90 <= 1000 ? 'A1' : p90 <= 2000 ? 'A2' : p90 <= 3500 ? 'B1' : p90 <= 5000 ? 'B2' : 'C1';
}

const slug = (s) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

const HOW_MANY = 24;

const BUNDLED_PER_LEVEL = 2; // a few offline starters per level; the rest download on demand

// Public-domain classics for the upper levels, where the children's-literacy sources thin out.
// All original English (no translation-copyright question); authors long dead (PD in RU too).
// CORS blocks a runtime browser fetch of gutenberg.org, so these are bundled at build time.
// Levels are EDITORIAL, not from the frequency estimator: literary difficulty (syntax,
// abstraction, archaic register) is real but nearly invisible to a word-frequency profile,
// which rates almost all narrative prose B1. Curated classics get a human level.
const GUTENBERG = [
  { id: 14838, title: 'The Tale of Peter Rabbit', author: 'Beatrix Potter', level: 'A2' },
  { id: 55, title: 'The Wonderful Wizard of Oz', author: 'L. Frank Baum', level: 'B1' },
  { id: 11, title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll', level: 'B1' },
  { id: 902, title: 'The Happy Prince and Other Tales', author: 'Oscar Wilde', level: 'B2' },
  { id: 35, title: 'The Time Machine', author: 'H. G. Wells', level: 'B2' },
  { id: 46, title: 'A Christmas Carol', author: 'Charles Dickens', level: 'B2' },
  { id: 174, title: 'The Picture of Dorian Gray', author: 'Oscar Wilde', level: 'C1' },
  { id: 84, title: 'Frankenstein', author: 'Mary Shelley', level: 'C1' },
];

/** Strip the Project Gutenberg trademark/license wrapper → unrestricted public-domain text. */
function stripGutenberg(raw) {
  const s = raw.search(/\*\*\*\s*START OF (THE|THIS) PROJECT GUTENBERG[^\n]*\*\*\*/i);
  const e = raw.search(/\*\*\*\s*END OF (THE|THIS) PROJECT GUTENBERG/i);
  const body = s >= 0 && e > s ? raw.slice(raw.indexOf('\n', s) + 1, e) : raw;
  return body.replace(/\r\n?/g, '\n').trim();
}

/** Split on CHAPTER headings when there are enough substantial ones; else one chapter. */
function splitChapters(body) {
  const marks = [...body.matchAll(/^[ \t]*(CHAPTER|STAVE|LETTER|PART|BOOK)\s+[IVXLCDM\d]+\.?[^\n]*$/gim)];
  if (marks.length < 2) return [{ id: 'c0', text: body }];
  const chapters = [];
  for (let i = 0; i < marks.length; i++) {
    const seg = body.slice(marks[i].index, i + 1 < marks.length ? marks[i + 1].index : body.length);
    const nl = seg.indexOf('\n');
    const title = seg.slice(0, nl).replace(/\s+/g, ' ').trim();
    const text = seg.slice(nl + 1).trim();
    if (text.length >= 300) chapters.push({ id: `c${chapters.length}`, title, text }); // drops TOC fragments
  }
  return chapters.length >= 2 ? chapters : [{ id: 'c0', text: body }];
}

const found = await storybookSearch({ query: '', limit: HOW_MANY });
const catalog = [];
const bundledCount = {};
mkdirSync(OUT_DIR, { recursive: true });

for (const hit of found) {
  let book;
  try {
    book = await storybookFetch(hit.path);
  } catch {
    continue; // non-redistributable license (CC-BY-NC etc.) or fetch error — skip
  }
  const text = book.pages.join('\n\n');
  if (text.length < 120) continue; // too short to be worth reading
  const level = levelOf(text);
  const id = slug(book.title) || slug(hit.path);

  const entry = { id, title: book.title, author: book.author, level, license: book.license };
  bundledCount[level] = bundledCount[level] ?? 0;
  if (bundledCount[level] < BUNDLED_PER_LEVEL) {
    bundledCount[level] += 1;
    writeFileSync(
      resolve(OUT_DIR, `${id}.json`),
      JSON.stringify({ title: book.title, author: book.author, chapters: [{ id: 'c0', text }] }) + '\n'
    );
    catalog.push({ ...entry, kind: 'bundled', path: `reader/catalog/${id}.json` });
  } else {
    catalog.push({ ...entry, kind: 'remote', mdUrl: book.sourceUrl });
  }
}

for (const g of GUTENBERG) {
  let raw;
  try {
    raw = await (await politeFetch(`https://www.gutenberg.org/cache/epub/${g.id}/pg${g.id}.txt`)).text();
  } catch {
    continue; // network/rate-limit — skip
  }
  const body = stripGutenberg(raw);
  if (body.length < 500) continue;
  const chapters = splitChapters(body);
  const level = g.level; // editorial (see note above), not levelOf(body)
  const id = slug(g.title);
  writeFileSync(
    resolve(OUT_DIR, `${id}.json`),
    JSON.stringify({ title: g.title, author: g.author, chapters }) + '\n'
  );
  catalog.push({
    id,
    title: g.title,
    author: g.author,
    level,
    license: {
      type: 'public-domain',
      attribution: `${g.author} · public domain`,
      sourceUrl: `https://www.gutenberg.org/ebooks/${g.id}`,
    },
    kind: 'bundled',
    path: `reader/catalog/${id}.json`,
  });
  console.log(`gutenberg: ${g.title} — ${level}, ${chapters.length} ch.`);
}

catalog.sort((a, b) => a.level.localeCompare(b.level) || a.title.localeCompare(b.title));
writeFileSync(MANIFEST, JSON.stringify({ books: catalog }, null, 2) + '\n');
const tally = (k) => catalog.filter((b) => b.kind === k).length;
console.log(`catalog: ${catalog.length} books (${tally('bundled')} bundled, ${tally('remote')} remote)`);
console.log('by level:', catalog.reduce((m, b) => ((m[b.level] = (m[b.level] || 0) + 1), m), {}));
