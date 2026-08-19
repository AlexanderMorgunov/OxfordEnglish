import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { storybookSearch, storybookFetch } from '../src/lib/storybooks.ts';
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

catalog.sort((a, b) => a.level.localeCompare(b.level) || a.title.localeCompare(b.title));
writeFileSync(MANIFEST, JSON.stringify({ books: catalog }, null, 2) + '\n');
const tally = (k) => catalog.filter((b) => b.kind === k).length;
console.log(`catalog: ${catalog.length} books (${tally('bundled')} bundled, ${tally('remote')} remote)`);
console.log('by level:', catalog.reduce((m, b) => ((m[b.level] = (m[b.level] || 0) + 1), m), {}));
