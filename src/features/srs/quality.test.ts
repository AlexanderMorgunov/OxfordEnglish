import 'fake-indexeddb/auto';
import { beforeEach, expect, test } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db, type SrsCard } from '@/db/db';
import {
  addPhraseCard,
  countDue,
  dropCard,
  getDueCards,
  gradeCard,
  Rating,
  repairCardBack,
  repairCardContext,
  repairSavedPhrase,
} from './service';
import { editCardAnswer } from '@/features/vocab/manage';
import { applyEntry, toEnvelope } from '@/features/sync/engine';
import type { SyncEntry } from '@/features/account/contract';
import {
  captureDataScope,
  invalidateDataScope,
} from '@/features/account/dataScope';

function card(over: Partial<SrsCard> = {}): SrsCard {
  const schedule = createEmptyCard(new Date(0));
  return {
    id: 'word:all',
    kind: 'word',
    front: 'all',
    back: 'all',
    tags: [],
    due: schedule.due,
    card: schedule,
    ...over,
  };
}

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.srsCards.clear(),
    db.wordStatus.clear(),
    db.pending.clear(),
    db.reviewLog.clear(),
  ]);
});

test('ignored terms are suspended from review and its count, then resume without resetting progress', async () => {
  const saved = card();
  await db.srsCards.put(saved);
  await db.wordStatus.put({
    word: 'all',
    status: 'ignored',
    firstSeenAt: 1,
    encounters: 1,
  });
  expect(await getDueCards()).toEqual([]);
  expect(await countDue()).toBe(0);
  expect((await db.srsCards.get(saved.id))?.card).toEqual(saved.card);
  await db.wordStatus.update('all', { status: 'learning' });
  expect((await getDueCards()).map((c) => c.id)).toEqual([saved.id]);
});

test('legacy mistake prompts do not inherit a vocabulary ignore status', async () => {
  await db.srsCards.put(card({ id: 'err:1', fromError: true }));
  await db.wordStatus.put({
    word: 'all',
    status: 'ignored',
    firstSeenAt: 1,
    encounters: 1,
  });
  expect(await countDue()).toBe(1);
});

test('a late translation cannot restore a tombstone', async () => {
  await db.srsCards.put(card({ updatedAt: 5, deletedAt: 5 }));
  expect(await repairCardBack('word:all', 'всё')).toBe(false);
  expect((await db.srsCards.get('word:all'))?.back).toBe('all');
});

test('concurrent grading and answer repair preserve both content and scheduling', async () => {
  await db.srsCards.put(card({ contextGloss: 'всё' }));
  await Promise.all([
    gradeCard('word:all', Rating.Good),
    repairCardBack('word:all', 'всё'),
  ]);
  const saved = (await db.srsCards.get('word:all'))!;
  expect(saved.back).toBe('всё');
  expect(saved.card.reps).toBe(1);
  expect(saved.due.getTime()).toBeGreaterThan(0);
});

test('editing alongside grading preserves the answer, schedule and one review event', async () => {
  const saved = card({ back: 'все' });
  await db.srsCards.put(saved);
  await Promise.all([
    gradeCard(saved.id, Rating.Good),
    editCardAnswer(saved, 'всё', ''),
  ]);
  const result = (await db.srsCards.get(saved.id))!;
  expect(result.back).toBe('всё');
  expect(result.card.reps).toBe(1);
  expect(await db.reviewLog.count()).toBe(1);
});

test('concurrent answer editing cannot revive a removed card', async () => {
  const saved = card({ back: 'все' });
  await db.srsCards.put(saved);
  await Promise.all([editCardAnswer(saved, 'всё', ''), dropCard(saved.id)]);
  const result = (await db.srsCards.get(saved.id))!;
  expect(result.deletedAt).toBeGreaterThanOrEqual(result.updatedAt!);
  expect(await getDueCards()).toEqual([]);
});

test('duplicate grades record one repetition and cards without an answer cannot be graded', async () => {
  await db.srsCards.put(card());
  expect(await gradeCard('word:all', Rating.Good)).toBe(false);
  await db.srsCards.update('word:all', { contextGloss: 'всё' });
  await Promise.all([
    gradeCard('word:all', Rating.Good, 0),
    gradeCard('word:all', Rating.Good, 0),
  ]);
  expect((await db.srsCards.get('word:all'))?.card.reps).toBe(1);
  expect(await db.reviewLog.count()).toBe(1);
});

test('late contextual meaning only fills a missing meaning in the matching sentence', async () => {
  await addPhraseCard(
    'sneaking suspicion',
    'sneaking suspicion',
    'I had a sneaking suspicion.',
    undefined,
    undefined
  );
  const id = 'phrase:sneaking suspicion';
  expect(
    await repairCardContext(id, 'Another sentence.', 'смутное подозрение')
  ).toBe(false);
  expect(
    await repairCardContext(
      id,
      'I had a sneaking suspicion.',
      'смутное подозрение'
    )
  ).toBe(true);
  expect(
    await repairCardContext(id, 'I had a sneaking suspicion.', 'другой ответ')
  ).toBe(false);
  expect((await db.srsCards.get(id))?.contextGloss).toBe('смутное подозрение');
});

test('a stale editor or a request from a previous data owner cannot change the answer', async () => {
  const saved = card({ back: 'все' });
  await db.srsCards.put(saved);
  await db.srsCards.update(saved.id, { back: 'каждый' });
  expect(await editCardAnswer(saved, 'всё', '')).toBe(false);
  const current = captureDataScope();
  invalidateDataScope();
  await db.srsCards.update(saved.id, { back: 'all' });
  expect(await repairCardBack(saved.id, 'всё', current)).toBe(false);
  expect((await db.srsCards.get(saved.id))?.back).toBe('all');
});

test('a late phrase translation preserves a different saved context or manual answer', async () => {
  const id = 'phrase:look up';
  await addPhraseCard('look up', 'look up', 'Look up at the sky.');
  const result = { text: 'найти информацию', contextual: true };
  expect(await repairSavedPhrase(id, 'Look up this word.', 'look up', result)).toBe(false);
  expect((await db.srsCards.get(id))?.back).toBe('look up');
  await db.srsCards.update(id, { back: 'посмотреть вверх' });
  expect(await repairSavedPhrase(id, 'Look up at the sky.', 'look up', result)).toBe(false);
  expect((await db.srsCards.get(id))?.contextGloss).toBeUndefined();
});

test('a phrase saved before completion receives both answer and contextual meaning atomically', async () => {
  const id = 'phrase:sneaking suspicion';
  const sentence = 'I had a sneaking suspicion.';
  await addPhraseCard('sneaking suspicion', 'sneaking suspicion', sentence);
  const result = { text: 'смутное подозрение', contextual: true };
  expect(await repairSavedPhrase(id, sentence, 'sneaking suspicion', result)).toBe(true);
  expect(await db.srsCards.get(id)).toMatchObject({ back: result.text, contextGloss: result.text });
});

test('an incoming sync answer and concurrent local grade preserve content and scheduling', async () => {
  const original = card({ back: 'все', updatedAt: 1, updatedBy: 'local' });
  await db.srsCards.put(original);
  const incoming = { ...original, back: 'всё', updatedAt: Date.now() + 1000, updatedBy: 'remote' };
  const entry: SyncEntry = { ...toEnvelope('srsCards', incoming), seq: 1 };
  await Promise.all([applyEntry(entry), gradeCard(original.id, Rating.Good, 0)]);
  const result = (await db.srsCards.get(original.id))!;
  expect(result.back).toBe('всё');
  expect(result.card.reps).toBe(1);
  expect(await db.reviewLog.count()).toBe(1);
});

test('a manual contextual clear and an edited dictionary answer block late word meaning repair', async () => {
  const original = card({ contextSentence: 'All is well.' });
  await db.srsCards.put(original);
  await editCardAnswer(original, '', '');
  expect(await repairCardContext(original.id, 'All is well.', 'всё')).toBe(false);
  await db.srsCards.update(original.id, { contextGloss: undefined, back: 'всё' });
  expect(await repairCardContext(original.id, 'All is well.', 'каждый', captureDataScope(), 'all')).toBe(false);
});

test('a grade cannot apply to an answer different from the one that was shown', async () => {
  const shown = card({ back: 'все' });
  await db.srsCards.put({ ...shown, back: 'всё' });
  expect(await gradeCard(shown.id, Rating.Good, shown.card.reps, shown)).toBe(false);
  expect(await db.reviewLog.count()).toBe(0);
});
