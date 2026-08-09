import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { politeFetch } from '../src/lib/net.ts';

const OUT = process.env.WORDLISTS_PATH ?? './data/wordlists.json';
const SAMPLE = './fixtures/wordlists-sample.json';

// Frequency rank = line number. A reliable, fetchable ranked list (MIT) — a
// practical stand-in for NGSL, which has no stable programmatic CSV URL.
const FREQ_URL =
  'https://raw.githubusercontent.com/first20hours/google-10000-english/master/google-10000-english-usa-no-swears.txt';
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

function parseFrequency(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  const words = text.split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter(Boolean);
  words.forEach((word, i) => {
    if (!(word in out)) out[word] = i + 1;
  });
  return out;
}

/** CEFR-J CSV columns: headword(0), pos(1), CEFR(2). */
function parseCefrj(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cols = line.split(',');
    const word = cols[0]?.trim().toLowerCase();
    const cefr = cols[2]?.trim();
    if (word && cefr) out[word] = cefr;
  }
  return out;
}

async function main(): Promise<void> {
  mkdirSync(dirname(OUT), { recursive: true });

  const freqRaw = await tryFetch(FREQ_URL);
  const cefrjRaw = await tryFetch(CEFRJ_CSV);

  if (!freqRaw && !cefrjRaw) {
    copyFileSync(SAMPLE, OUT);
    console.log(`! could not reach the wordlist sources — wrote the bundled sample to ${OUT}.`);
    return;
  }

  const sample = JSON.parse(readFileSync(SAMPLE, 'utf8')) as {
    ngsl: Record<string, number>;
    cefrj: Record<string, string>;
  };
  const ngsl = freqRaw ? parseFrequency(freqRaw) : sample.ngsl;
  const cefrj = cefrjRaw ? parseCefrj(cefrjRaw) : sample.cefrj;

  writeFileSync(OUT, JSON.stringify({ ngsl, cefrj }));
  console.log(
    `✓ wrote ${OUT} — freq: ${Object.keys(ngsl).length}, cefrj: ${Object.keys(cefrj).length}`
  );
}

await main();
