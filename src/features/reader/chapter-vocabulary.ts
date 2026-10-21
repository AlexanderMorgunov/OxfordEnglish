import { db, type SettingRecord, type SrsCard } from '@/db/db';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { dictionaryAnswer } from '@/features/srs/answer';
import { currentInstallId, isSyncing } from '@/features/sync/local';
import { markDirty } from '@/features/sync/engine';
import { isDeleted } from '@/features/sync/resolve';
import { nudgeSync } from '@/features/sync/run';

export type BookSource = { bookKey: string; chapterId: string };
export type ReaderTerm = BookSource & {
  version: 1;
  cardId: string;
  contextSentence?: string;
  savedAt: number;
};
export type ChapterTerm = { id: string; front: string; answer?: string; sentence?: string };
export const READER_TERM_PREFIX = 'reader-term:';

const nonempty = (value: unknown): value is string => typeof value === 'string' && !!value.trim();

export function parseReaderTerm(value: unknown): ReaderTerm | undefined {
  if (!value || typeof value !== 'object') return;
  const v = value as Record<string, unknown>;
  if (v.version !== 1 || !nonempty(v.bookKey) || !v.bookKey.startsWith('reader.') ||
    !nonempty(v.chapterId) || !nonempty(v.cardId) || !/^(word|phrase):.+/.test(v.cardId) ||
    typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt <= 0 ||
    (v.contextSentence !== undefined && typeof v.contextSentence !== 'string')) return;
  return { version: 1, bookKey: v.bookKey, chapterId: v.chapterId, cardId: v.cardId,
    savedAt: v.savedAt, contextSentence: v.contextSentence as string | undefined };
}

async function hash(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('');
}

export async function chapterTermPrefix(source: BookSource): Promise<string> {
  return `${READER_TERM_PREFIX}${await hash(JSON.stringify([source.bookKey, source.chapterId]))}:`;
}

export async function readerTermKey(source: BookSource, cardId: string): Promise<string> {
  return `${await chapterTermPrefix(source)}${await hash(cardId)}`;
}

export async function validatedReaderTermRows(rows: unknown[]): Promise<SettingRecord[]> {
  const valid: SettingRecord[] = [];
  for (const raw of rows) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as SettingRecord;
    const value = parseReaderTerm(row.value);
    if (!value || row.key !== await readerTermKey(value, value.cardId)) continue;
    if ((row.updatedAt !== undefined && (!Number.isFinite(row.updatedAt) || row.updatedAt <= 0)) ||
      (row.deletedAt !== undefined && (!Number.isFinite(row.deletedAt) || row.deletedAt <= 0)) ||
      (row.updatedBy !== undefined && (typeof row.updatedBy !== 'string' || row.updatedBy.length < 1 || row.updatedBy.length > 64))) continue;
    valid.push({ key: row.key, value, updatedAt: row.updatedAt ?? value.savedAt,
      updatedBy: row.updatedBy, deletedAt: row.deletedAt });
  }
  return valid;
}

function matchesCard(card: SrsCard | undefined, id: string): card is SrsCard {
  return !!card && !isDeleted(card) && !card.fromError &&
    (card.kind === 'word' || card.kind === 'phrase') &&
    id === `${card.kind}:${card.front.toLowerCase()}`;
}

export async function saveReaderTerm(
  source: BookSource, cardId: string, contextSentence?: string,
  current = captureDataScope()
): Promise<boolean> {
  try {
    // Crypto and install identity must resolve before entering an IndexedDB transaction.
    const key = await readerTermKey(source, cardId);
    const writer = await currentInstallId();
    const syncing = isSyncing();
    const saved = await db.transaction('rw', [db.books, db.srsCards, db.settings, db.pending], async () => {
      requireDataScope(current);
      if (!source.bookKey.startsWith('reader.catalog.')) {
        const book = await db.books.get(source.bookKey.slice('reader.'.length));
        if (!book || isDeleted(book)) return false;
      }
      if (!matchesCard(await db.srsCards.get(cardId), cardId)) return false;
      const previous = await db.settings.get(key);
      requireDataScope(current);
      const timestamp = Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1, (previous?.deletedAt ?? 0) + 1);
      const value: ReaderTerm = { ...source, version: 1, cardId, contextSentence, savedAt: timestamp };
      const row: SettingRecord = { key, value, updatedAt: timestamp, updatedBy: writer };
      await db.settings.put(row);
      if (syncing) await markDirty('settings', { ...row });
      requireDataScope(current);
      return true;
    });
    if (saved && syncing && current()) nudgeSync();
    return saved && current();
  } catch {
    return false;
  }
}

export async function readChapterTerms(source: BookSource, prefix: string): Promise<ChapterTerm[]> {
  const rows = await db.settings.where('key').startsWith(prefix).toArray();
  const ignored = new Set((await db.wordStatus.where('status').equals('ignored').toArray()).map((w) => w.word));
  const terms = new Map<string, ChapterTerm>();
  for (const row of rows) {
    const value = parseReaderTerm(row.value);
    if (!value || isDeleted(row) || value.bookKey !== source.bookKey || value.chapterId !== source.chapterId) continue;
    const card = await db.srsCards.get(value.cardId);
    if (!matchesCard(card, value.cardId) || ignored.has(card.front.toLowerCase())) continue;
    const answer = card.contextSentence === value.contextSentence
      ? card.contextGloss?.trim() || dictionaryAnswer(card) : dictionaryAnswer(card);
    terms.set(row.key, { id: card.id, front: card.front, answer, sentence: value.contextSentence });
  }
  const valid = await validatedReaderTermRows(rows);
  const byId = new Map<string, ChapterTerm>();
  for (const row of valid) {
    const term = terms.get(row.key);
    if (term) byId.set(term.id, term);
  }
  return [...byId.values()].sort((a, b) => a.front.localeCompare(b.front, 'en'));
}
