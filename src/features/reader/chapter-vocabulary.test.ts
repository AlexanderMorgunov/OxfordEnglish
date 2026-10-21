import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { captureDataScope, invalidateDataScope } from '@/features/account/dataScope';
import { applyEntry } from '@/features/sync/engine';
import { SyncChangeSchema } from '@/features/account/contract';
import { SyncChangeSchema as ServerSyncChangeSchema } from '../../../server/src/contract';
import { exportData, importData } from '@/features/progress/backup';
import * as local from '@/features/sync/local';
import { chapterTermPrefix, readChapterTerms, readerTermKey, saveReaderTerm, validatedReaderTermRows } from './chapter-vocabulary';

const source = { bookKey: 'reader.catalog.test', chapterId: 'chapter-1' };
const read = async (s = source) => readChapterTerms(s, await chapterTermPrefix(s));

beforeEach(async () => {
  invalidateDataScope();
  await db.open();
  await Promise.all([db.settings, db.srsCards, db.wordStatus, db.pending, db.books, db.activity, db.reviewLog, db.attempts].map((table) => table.clear()));
});
afterEach(() => vi.restoreAllMocks());

test('only explicit successful saves create source membership; existing cards keep their schedule', async () => {
  await addWordCard('bank', 'банк', 'A bank.', 'банк в этом предложении');
  expect(await read()).toEqual([]);
  const before = await db.srsCards.get('word:bank');
  expect(await saveReaderTerm(source, 'word:missing')).toBe(false);
  expect(await saveReaderTerm(source, 'word:bank', 'A bank.')).toBe(true);
  expect(await db.srsCards.get('word:bank')).toEqual(before);
  expect(await read()).toEqual([{ id: 'word:bank', front: 'bank', answer: 'банк в этом предложении', sentence: 'A bank.' }]);
  const other = { ...source, chapterId: 'chapter-2' };
  expect(await saveReaderTerm(other, 'word:bank', 'A river bank.')).toBe(true);
  expect((await read(other))[0]?.answer).toBe('банк');
  await db.srsCards.update('word:bank', { back: 'ручной перевод', contextGloss: undefined });
  expect((await read())[0]?.answer).toBe('ручной перевод');
  expect((await read(other))[0]?.answer).toBe('ручной перевод');
});

test('phrases without answers appear in the list and late answers are read from the live card', async () => {
  await addPhraseCard('take care', 'take care', 'Take care.');
  await saveReaderTerm(source, 'phrase:take care', 'Take care.');
  expect((await read())[0]?.answer).toBeUndefined();
  await db.srsCards.update('phrase:take care', { back: 'береги себя' });
  expect((await read())[0]?.answer).toBe('береги себя');
});

test('ignored, deleted and malformed memberships do not leak into the list', async () => {
  await addWordCard('bank', 'банк');
  await saveReaderTerm(source, 'word:bank');
  const row = (await db.settings.toArray())[0]!;
  await db.settings.put({ ...row, key: `${await chapterTermPrefix(source)}${'0'.repeat(64)}` });
  expect(await read()).toHaveLength(1);
  await db.wordStatus.put({ word: 'bank', status: 'ignored', firstSeenAt: 1, encounters: 1 });
  expect(await read()).toEqual([]);
  await db.wordStatus.clear();
  await db.srsCards.update('word:bank', { deletedAt: Date.now() + 10 });
  expect(await read()).toEqual([]);
  expect(await saveReaderTerm(source, 'word:bank')).toBe(false);
});

test('imported sources require a live book; old owner requests cannot write membership', async () => {
  const imported = { bookKey: 'reader.imported', chapterId: 'one' };
  await addWordCard('bank', 'банк');
  expect(await saveReaderTerm(imported, 'word:bank')).toBe(false);
  await db.books.put({ id: 'imported', title: 'Test', format: 'epub', addedAt: 1, chapterCount: 1, lastChapter: 0 });
  const current = captureDataScope();
  invalidateDataScope();
  expect(await saveReaderTerm(imported, 'word:bank', undefined, current)).toBe(false);
  expect(await db.settings.count()).toBe(0);
  await db.books.update('imported', { deletedAt: 2 });
  expect(await saveReaderTerm(imported, 'word:bank')).toBe(false);
});

test('scope invalidation during put rolls back the membership and its pending marker', async () => {
  vi.spyOn(local, 'isSyncing').mockReturnValue(true);
  await addWordCard('bank', 'банк');
  await db.pending.clear();
  const original = db.settings.put.bind(db.settings);
  vi.spyOn(db.settings, 'put').mockImplementation((...args) => original(...args).then((result) => {
    invalidateDataScope();
    return result;
  }));
  expect(await saveReaderTerm(source, 'word:bank')).toBe(false);
  expect(await db.settings.count()).toBe(0);
  expect(await db.pending.count()).toBe(0);
});

test('long chapter/phrase identities fit both wire contracts and generic sync preserves separate additions', async () => {
  const longSource = { ...source, chapterId: 'epub/'.repeat(100) };
  await addPhraseCard('long phrase '.repeat(40).trim(), 'перевод');
  const card = (await db.srsCards.toArray())[0]!;
  await saveReaderTerm(longSource, card.id);
  const row = (await db.settings.toArray())[0]!;
  const change = { store: 'settings', id: row.key, payload: row, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
  expect(row.key.length).toBeLessThanOrEqual(200);
  expect(SyncChangeSchema.safeParse(change).success).toBe(true);
  expect(ServerSyncChangeSchema.safeParse(change).success).toBe(true);
  const remoteSource = { ...longSource, chapterId: 'remote' };
  const remote = { ...row, key: await readerTermKey(remoteSource, card.id), value: { ...(row.value as object), ...remoteSource }, updatedAt: row.updatedAt! + 10, updatedBy: 'remote' };
  await applyEntry({ store: 'settings', id: remote.key, seq: 1, updatedAt: remote.updatedAt, updatedBy: remote.updatedBy, payload: remote });
  await applyEntry({ store: 'settings', id: row.key, seq: 2, updatedAt: row.updatedAt! - 1, updatedBy: 'older', payload: { ...row, updatedAt: row.updatedAt! - 1, updatedBy: 'older' } });
  expect(await read(longSource)).toHaveLength(1);
  expect(await read(remoteSource)).toHaveLength(1);
});

test('backup exports and restores only validated reader terms, without unrelated settings', async () => {
  await addWordCard('bank', 'банк');
  await saveReaderTerm(source, 'word:bank');
  await db.settings.put({ key: 'private-setting', value: 'private-value' });
  const json = await exportData();
  expect(json).not.toContain('private-value');
  const payload = JSON.parse(json);
  expect(payload.readerTerms).toHaveLength(1);
  payload.readerTerms.push({ key: 'private-setting', value: 'replacement' });
  payload.readerTerms.push({ ...payload.readerTerms[0], key: `${await chapterTermPrefix(source)}${'0'.repeat(64)}` });
  await db.settings.where('key').startsWith('reader-term:').delete();
  await importData(JSON.stringify(payload));
  expect(await read()).toHaveLength(1);
  expect((await db.settings.get('private-setting'))?.value).toBe('private-value');
  expect(await db.settings.count()).toBe(2);
  await importData('{"version":3}');
  expect(await read()).toHaveLength(1);
});

test('learning status writes also reject stale owner lifetimes', async () => {
  const current = captureDataScope();
  invalidateDataScope();
  await expect(local.putWordStatus({ word: 'bank', status: 'learning', firstSeenAt: 1, encounters: 1 }, current)).rejects.toThrow('Data owner changed');
  expect(await db.wordStatus.count()).toBe(0);
});

test('backup validation rejects invalid wire writers and keeps absent metadata restorable', async () => {
  await addWordCard('bank', 'банк');
  await saveReaderTerm(source, 'word:bank');
  const row = (await db.settings.toArray())[0]!;
  expect(await validatedReaderTermRows([{ ...row, updatedBy: '' }, { ...row, updatedBy: 'x'.repeat(65) }])).toEqual([]);
  expect(await validatedReaderTermRows([{ ...row, updatedBy: undefined }])).toHaveLength(1);
});

test('membership/pending writes are atomic and retries carry monotonic timestamps', async () => {
  vi.spyOn(local, 'isSyncing').mockReturnValue(true);
  await addWordCard('bank', 'банк');
  await saveReaderTerm(source, 'word:bank');
  const row = (await db.settings.toArray())[0]!;
  expect((await db.pending.toArray()).some(p => p.store === 'settings' && p.id === row.key)).toBe(true);
  await db.settings.update(row.key, { updatedAt: Date.now() + 10000 });
  await saveReaderTerm(source, 'word:bank');
  expect((await db.settings.get(row.key))!.updatedAt).toBeGreaterThan(Date.now() + 9000);
});
