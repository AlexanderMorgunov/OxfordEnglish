// Builds public/reader/en-cefr.json from the CEFR-J Vocabulary Profile 1.5 (Open Language Profiles).
// Usage: node scripts/build-cefr.mjs [path/to/cefrj-vocabulary-profile-1.5.csv]  (downloads it when omitted)
import { readFileSync, writeFileSync } from 'node:fs';

const SRC =
  'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv';
const CITATION =
  'The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html on 1/20/2020.';
const LEVELS = ['A1', 'A2', 'B1', 'B2'];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field || row.length) rows.push([...row, field]);
  return rows;
}

const csv = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : await (await fetch(SRC)).text();
const [header, ...rows] = parseCsv(csv);
if (header.slice(0, 3).join() !== 'headword,pos,CEFR') throw new Error(`unexpected header: ${header.join()}`);

// A headword listed under several parts of speech keeps its easiest level.
const level = new Map();
for (const [headword = '', , cefr = ''] of rows) {
  const lvl = LEVELS.indexOf(cefr.trim());
  if (lvl < 0) continue;
  for (const h of headword.split('/').map((s) => s.trim().toLowerCase()).filter(Boolean)) {
    level.set(h, Math.min(level.get(h) ?? lvl, lvl));
  }
}

// Within a level, more frequent first: BNC lemma rank (lemma.en); words it lacks because they never
// inflect ("the", "because") fall back to the web frequency rank, which is skewed toward web vocabulary.
const lemmaOrder = Object.keys(JSON.parse(readFileSync('public/reader/en-lemma.json', 'utf8')).map);
const webOrder = JSON.parse(readFileSync('public/reader/en-freq.json', 'utf8')).words;
const bnc = new Map(lemmaOrder.map((w, i) => [w, i]));
const web = new Map(webOrder.map((w, i) => [w, i]));
const rank = (w) => bnc.get(w) ?? web.get(w) ?? Infinity;

const levels = LEVELS.map(() => []);
for (const [w, lvl] of [...level].sort((a, b) => rank(a[0]) - rank(b[0]) || a[0].localeCompare(b[0]))) {
  levels[lvl].push(w);
}

const out = {
  meta: {
    source: 'CEFR-J Vocabulary Profile 1.5 via Open Language Profiles (olp-en-cefrj)',
    citation: CITATION,
    format: 'levels[i] = headwords at LEVELS[i], most frequent first',
    levels: LEVELS,
  },
  levels,
};
writeFileSync('public/reader/en-cefr.json', JSON.stringify(out));
console.log(LEVELS.map((l, i) => `${l} ${levels[i].length}`).join(' · '), `· total ${level.size}`);
