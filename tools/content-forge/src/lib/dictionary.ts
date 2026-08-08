import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { DICTIONARY_DB as DB_PATH } from './paths.ts';
import type { LicenseInfo } from './license.ts';

export type Sense = { partOfSpeech: string; definition: string; example?: string };

export type DictEntry = {
  word: string;
  ipa?: string;
  audioUrl?: string;
  senses: Sense[];
  license: LicenseInfo;
};

type Row = {
  word: string;
  ipa: string | null;
  audio_url: string | null;
  senses_json: string;
};

export function dictLookup(word: string): DictEntry | null {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Dictionary DB missing at ${DB_PATH} — run "npm run import:dict"`);
  }
  const db = new DatabaseSync(DB_PATH);
  const row = db
    .prepare('SELECT word, ipa, audio_url, senses_json FROM entries WHERE word = ?')
    .get(word.toLowerCase()) as Row | undefined;
  db.close();
  if (!row) return null;

  return {
    word: row.word,
    ipa: row.ipa ?? undefined,
    audioUrl: row.audio_url ?? undefined,
    senses: JSON.parse(row.senses_json) as Sense[],
    // Wiktionary content (via kaikki/Wiktextract) is CC BY-SA — ShareAlike must be carried forward.
    license: {
      type: 'CC-BY-SA',
      attribution: 'Wiktionary via kaikki.org (Wiktextract)',
      sourceUrl: `https://en.wiktionary.org/wiki/${encodeURIComponent(word)}`,
    },
  };
}
