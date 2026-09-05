// Build public/reader/en-lemma.json (lemma -> inflected forms) from skywind3000/lemma.en (MIT).
// Top-N by BNC frequency: irregulars cluster in high frequency, so this captures them; the regular
// long tail is handled at runtime by stems() in difficulty.ts. Keeps the bundled asset small.
// Run: node scripts/build-lemma.mjs   (fetches the source list; output is committed).
import fs from 'node:fs';

const SRC = 'https://raw.githubusercontent.com/skywind3000/lemma.en/master/lemma.en.txt';
const OUT = 'public/reader/en-lemma.json';
const TOP_N = 15000;

const isWord = (s) => /^[a-z][a-z-]*$/.test(s) && s.length > 1;

const txt = await (await fetch(SRC)).text();
const rows = [];
for (const line of txt.split(/\r?\n/)) {
  if (!line || line.startsWith(';')) continue;
  const m = line.match(/^(.+?)\/(\d+)\s*->\s*(.*)$/);
  if (!m) continue;
  const lemma = m[1].trim();
  if (!isWord(lemma)) continue;
  const forms = m[3].split(',').map((s) => s.trim()).filter((f) => isWord(f) && f !== lemma);
  if (forms.length) rows.push([lemma, +m[2], forms]);
}
rows.sort((a, b) => b[1] - a[1]);

const map = {};
for (const [lemma, , forms] of rows.slice(0, TOP_N)) map[lemma] = forms;

const out = {
  meta: {
    source: 'skywind3000/lemma.en',
    license: 'MIT — En Lemma Database (c) 2017 Linwei',
    note: `top ${TOP_N} lemmas by BNC frequency; regular tail handled by stems()`,
  },
  map,
};
fs.writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT}: ${Object.keys(map).length} lemmas, ${(fs.statSync(OUT).size / 1024).toFixed(0)} KB`);
