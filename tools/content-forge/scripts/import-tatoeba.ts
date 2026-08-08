import { DatabaseSync } from 'node:sqlite';
import { createReadStream, mkdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { dirname } from 'node:path';

const DB_PATH = process.env.TATOEBA_DB ?? './data/tatoeba.sqlite';

function initDb(): DatabaseSync {
  mkdirSync(dirname(DB_PATH), { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    DROP TABLE IF EXISTS sentences;
    CREATE TABLE sentences(
      id INTEGER PRIMARY KEY,
      en TEXT NOT NULL,
      ru TEXT,
      audio_license TEXT,
      audio_author TEXT
    );
    CREATE INDEX idx_en ON sentences(en);
  `);
  return db;
}

function importSample(db: DatabaseSync): number {
  const rows = readFileSync('./fixtures/tatoeba-sample.tsv', 'utf8')
    .trim()
    .split('\n')
    .slice(1);
  const stmt = db.prepare(
    'INSERT INTO sentences(id, en, ru, audio_license, audio_author) VALUES(?, ?, ?, ?, ?)'
  );
  for (const line of rows) {
    const [id, en, ru, license, author] = line.split('\t');
    stmt.run(Number(id), en ?? '', ru || null, license || null, author || null);
  }
  return rows.length;
}

async function readTsv(path: string, onRow: (cols: string[]) => void): Promise<void> {
  const rl = createInterface({ input: createReadStream(path, 'utf8'), crlfDelay: Infinity });
  for await (const line of rl) if (line) onRow(line.split('\t'));
}

/**
 * Real weekly dumps (https://tatoeba.org/en/downloads):
 *   TATOEBA_SENTENCES  sentences.csv             id \t lang \t text
 *   TATOEBA_LINKS      links.csv                 sentence_id \t translation_id
 *   TATOEBA_AUDIO      sentences_with_audio.csv  sentence_id \t username \t license \t url
 */
async function importDumps(db: DatabaseSync): Promise<number> {
  const sentencesCsv = process.env.TATOEBA_SENTENCES;
  const linksCsv = process.env.TATOEBA_LINKS;
  const audioCsv = process.env.TATOEBA_AUDIO;
  if (!sentencesCsv || !linksCsv) {
    throw new Error(
      'set TATOEBA_SENTENCES and TATOEBA_LINKS (and optionally TATOEBA_AUDIO) to the dump paths, or pass --sample'
    );
  }

  const eng = new Map<number, string>();
  const rus = new Map<number, string>();
  await readTsv(sentencesCsv, ([id, lang, text]) => {
    if (!id || !text) return;
    if (lang === 'eng') eng.set(Number(id), text);
    else if (lang === 'rus') rus.set(Number(id), text);
  });

  const ruFor = new Map<number, string>();
  await readTsv(linksCsv, ([a, b]) => {
    const from = Number(a);
    const to = Number(b);
    if (eng.has(from) && rus.has(to) && !ruFor.has(from)) ruFor.set(from, rus.get(to)!);
  });

  const audio = new Map<number, { license: string; author: string }>();
  if (audioCsv) {
    await readTsv(audioCsv, ([id, username, license]) => {
      if (id && license) audio.set(Number(id), { license, author: username ?? '' });
    });
  }

  const stmt = db.prepare(
    'INSERT INTO sentences(id, en, ru, audio_license, audio_author) VALUES(?, ?, ?, ?, ?)'
  );
  let count = 0;
  for (const [id, en] of eng) {
    const a = audio.get(id);
    stmt.run(id, en, ruFor.get(id) ?? null, a?.license ?? null, a?.author ?? null);
    count++;
  }
  return count;
}

const db = initDb();
const n = process.argv.includes('--sample')
  ? importSample(db)
  : await importDumps(db);
db.close();
console.log(`✓ imported ${n} sentences → ${DB_PATH}`);
