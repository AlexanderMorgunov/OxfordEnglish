import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { tokenize } from './text.ts';
import { ngslRank } from './level.ts';
import { TATOEBA_DB as DB_PATH } from './paths.ts';
import type { LicenseInfo } from './license.ts';

export type TatoebaSentence = {
  id: number;
  en: string;
  ru?: string;
  license: LicenseInfo;
  audio?: { url: string; license: LicenseInfo };
};

export type TatoebaSearchOptions = {
  query?: string;
  maxNgslRank?: number;
  requireRussian?: boolean;
  requireAudio?: boolean;
  maxWords?: number;
  limit?: number;
};

type Row = {
  id: number;
  en: string;
  ru: string | null;
  audio_license: string | null;
  audio_author: string | null;
};

export function tatoebaSearch(
  opts: TatoebaSearchOptions
): { count: number; sentences: TatoebaSentence[] } {
  if (!existsSync(DB_PATH)) {
    throw new Error(`Tatoeba DB missing at ${DB_PATH} — run "npm run import:tatoeba"`);
  }
  const {
    query,
    maxNgslRank,
    requireRussian = true,
    requireAudio = false,
    maxWords = 14,
    limit = 20,
  } = opts;

  const db = new DatabaseSync(DB_PATH);
  const where = ['1=1'];
  const params: (string | number)[] = [];
  if (query) {
    where.push('en LIKE ?');
    params.push(`%${query}%`);
  }
  if (requireRussian) where.push('ru IS NOT NULL');
  if (requireAudio) where.push('audio_license IS NOT NULL');
  params.push(limit * 12);

  const rows = db
    .prepare(
      `SELECT id, en, ru, audio_license, audio_author FROM sentences
       WHERE ${where.join(' AND ')} LIMIT ?`
    )
    .all(...params) as Row[];
  db.close();

  const sentences: TatoebaSentence[] = [];
  for (const row of rows) {
    const words = tokenize(row.en);
    if (words.length > maxWords) continue;
    if (
      maxNgslRank &&
      words.some((w) => {
        const rank = ngslRank(w);
        return rank === null || rank > maxNgslRank;
      })
    ) {
      continue;
    }

    // Audio license is chosen by whoever recorded it — verify, never assume from text.
    const openAudio = row.audio_license && /^CC/i.test(row.audio_license);

    sentences.push({
      id: row.id,
      en: row.en,
      ru: row.ru ?? undefined,
      license: {
        type: 'CC-BY',
        attribution: `Tatoeba (sentence #${row.id}), CC BY 2.0 FR`,
        sourceUrl: `https://tatoeba.org/en/sentences/show/${row.id}`,
      },
      audio: openAudio
        ? {
            url: `https://audio.tatoeba.org/sentences/eng/${row.id}.mp3`,
            license: {
              type: 'CC-BY',
              attribution: `${row.audio_author ?? 'Tatoeba contributor'} via Tatoeba, ${row.audio_license}`,
              sourceUrl: `https://tatoeba.org/en/sentences/show/${row.id}`,
            },
          }
        : undefined,
    });
    if (sentences.length >= limit) break;
  }

  return { count: sentences.length, sentences };
}
