import 'fake-indexeddb/auto';
import { test, expect, beforeEach } from 'vitest';
import { db } from '@/db/db';
import { getInstallId } from './meta';
import { stampSetting } from './local';
import { hydrateSettings } from './settingsBridge';
import { useLearner } from '@/features/learner/store'; // importing registers the 'learner' bridge

beforeEach(async () => {
  if (!db.isOpen()) await db.open();
  await Promise.all([db.settings.clear(), db.pending.clear()]);
  useLearner.setState({ level: null, recommendedUnitId: null, placementDone: false });
});

test('stampSetting writes db.settings; anonymous → no dirty marker', async () => {
  await stampSetting('ui', { lang: 'en' });
  expect((await db.settings.get('ui'))?.value).toEqual({ lang: 'en' });
  expect(await db.pending.count()).toBe(0); // not signed in → nothing queued
});

test("hydrateSettings applies another device's learner state", async () => {
  await db.settings.put({ key: 'learner', value: { level: 'B1', recommendedUnitId: 'u17', placementDone: true }, updatedAt: 1000, updatedBy: 'other-device' });
  await hydrateSettings();
  expect(useLearner.getState().level).toBe('B1');
  expect(useLearner.getState().placementDone).toBe(true);
});

test('hydrateSettings skips rows this install wrote (never reverts a local change)', async () => {
  const installId = await getInstallId();
  useLearner.setState({ level: 'A2', recommendedUnitId: 'u01', placementDone: true });
  await db.settings.put({ key: 'learner', value: { level: null, recommendedUnitId: null, placementDone: false }, updatedAt: 1, updatedBy: installId });
  await hydrateSettings();
  expect(useLearner.getState().level).toBe('A2'); // own row ignored
});

test('placementDone is monotonic — a stale false never re-shows placement', async () => {
  useLearner.setState({ level: 'B1', recommendedUnitId: 'u17', placementDone: true });
  await db.settings.put({ key: 'learner', value: { level: 'B1', recommendedUnitId: 'u17', placementDone: false }, updatedAt: 1, updatedBy: 'other-device' });
  await hydrateSettings();
  expect(useLearner.getState().placementDone).toBe(true);
});
