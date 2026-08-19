import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

// Trim the (gitignored) full frequency table to a small, committed asset the reader
// ships to estimate book difficulty. Rank = array index + 1. Top N covers the vast
// majority of any English text; personal vocabulary is layered on top at runtime.
const TOP = 6000;

const src = resolve(process.cwd(), 'data/wordlists.json');
const out = resolve(process.cwd(), '../../public/reader/en-freq.json');

const { ngsl } = JSON.parse(readFileSync(src, 'utf8'));
const words = Object.entries(ngsl)
  // keep real words; drop web-junk single letters/symbols but never "a" or "i"
  .filter(([w]) => /^[a-z]+$/.test(w) && (w.length > 1 || w === 'a' || w === 'i'))
  .sort((a, b) => a[1] - b[1])
  .slice(0, TOP)
  .map(([w]) => w);

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ words }) + '\n');
console.log(`wrote ${words.length} words to public/reader/en-freq.json`);
