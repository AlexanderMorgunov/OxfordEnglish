import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';

const DB_PATH = process.env.DICTIONARY_DB ?? './data/dictionary.sqlite';

type KaikkiSound = { ipa?: string; audio?: string; mp3_url?: string; ogg_url?: string };
type KaikkiSense = { glosses?: string[]; examples?: { text?: string }[] };
type KaikkiRecord = {
  word?: string;
  pos?: string;
  sounds?: KaikkiSound[];
  senses?: KaikkiSense[];
};

function initDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    DROP TABLE IF EXISTS entries;
    CREATE TABLE entries(
      word TEXT PRIMARY KEY,
      ipa TEXT,
      audio_url TEXT,
      senses_json TEXT NOT NULL
    );
  `);
  return db;
}

/**
 * Import a kaikki.org (Wiktextract) English JSONL dump — one JSON object per line.
 * Download: https://kaikki.org/dictionary/English/ (the English-only postprocessed set).
 * Set KAIKKI_JSONL to the file path, or pass --sample for the bundled fixture.
 * First record per word wins (INSERT OR IGNORE) — enough for a glossary IPA + sense.
 */
async function run(): Promise<void> {
  const path = process.argv.includes('--sample')
    ? './fixtures/dictionary-sample.jsonl'
    : process.env.KAIKKI_JSONL;
  if (!path) {
    throw new Error('set KAIKKI_JSONL to the dump path, or pass --sample');
  }

  const db = initDb();
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO entries(word, ipa, audio_url, senses_json) VALUES(?, ?, ?, ?)'
  );

  const rl = createInterface({
    input: createReadStream(path, 'utf8'),
    crlfDelay: Infinity,
  });
  let count = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let rec: KaikkiRecord;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (!rec.word) continue;

    const sound = rec.sounds ?? [];
    const ipa = sound.find((s) => s.ipa)?.ipa ?? null;
    const audio =
      sound.find((s) => s.mp3_url)?.mp3_url ??
      sound.find((s) => s.ogg_url)?.ogg_url ??
      sound.find((s) => s.audio)?.audio ??
      null;

    const senses = (rec.senses ?? [])
      .filter((s) => s.glosses?.[0])
      .slice(0, 3)
      .map((s) => ({
        partOfSpeech: rec.pos ?? 'unknown',
        definition: s.glosses![0],
        example: s.examples?.[0]?.text,
      }));
    if (senses.length === 0) continue;

    stmt.run(rec.word.toLowerCase(), ipa, audio, JSON.stringify(senses));
    count++;
  }
  db.close();
  console.log(`✓ imported ${count} dictionary entries → ${DB_PATH}`);
}

await run();
