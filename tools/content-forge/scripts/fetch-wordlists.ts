import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { politeFetch } from '../src/lib/net.ts';

const OUT = process.env.WORDLISTS_PATH ?? './data/wordlists.json';
const SAMPLE = './fixtures/wordlists-sample.json';

// Correct, still-owned domain (the .org variant was hijacked).
const NGSL_CSV = 'https://www.newgeneralservicelist.com/s/NGSL-101-by-band.csv';
const CEFRJ_CSV =
  'https://raw.githubusercontent.com/openlanguageprofiles/olp-en-cefrj/master/cefrj-vocabulary-profile-1.5.csv';

async function tryFetch(url: string): Promise<string | null> {
  try {
    const res = await politeFetch(url);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

/** Parse a CSV column pair into a record, skipping the header row. */
function parseCsv(
  text: string,
  wordCol: number,
  valueCol: number,
  transform: (v: string) => string | number
): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const lines = text.split(/\r?\n/).slice(1);
  for (const line of lines) {
    const cols = line.split(',');
    const word = cols[wordCol]?.trim().toLowerCase();
    const value = cols[valueCol]?.trim();
    if (word && value) out[word] = transform(value);
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });

  const ngslRaw = await tryFetch(NGSL_CSV);
  const cefrjRaw = await tryFetch(CEFRJ_CSV);

  if (!ngslRaw && !cefrjRaw) {
    copyFileSync(SAMPLE, OUT);
    console.log(
      `! could not reach the wordlist sources — wrote the bundled sample to ${OUT}.\n` +
        `  Re-run with network access to fetch the full NGSL + CEFR-J lists.`
    );
    return;
  }

  const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as {
    ngsl: Record<string, number>;
    cefrj: Record<string, string>;
  };

  const ngsl = ngslRaw
    ? (parseCsv(ngslRaw, 0, 1, (v) => Number(v) || 9999) as Record<string, number>)
    : sample.ngsl;
  // CEFR-J CSV columns: headword(0), pos(1), CEFR(2).
  const cefrj = cefrjRaw
    ? (parseCsv(cefrjRaw, 0, 2, (v) => v) as Record<string, string>)
    : sample.cefrj;

  writeFileSync(OUT, JSON.stringify({ ngsl, cefrj }));
  console.log(
    `✓ wrote ${OUT} — ngsl: ${Object.keys(ngsl).length}, cefrj: ${Object.keys(cefrj).length}`
  );
}

await main();
