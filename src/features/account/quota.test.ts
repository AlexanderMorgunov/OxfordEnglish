import { test, expect } from 'vitest';
import { quotaLevel, quotaNotice, hasManagedAi, QUOTA_WARN_AT } from './entitlement';
import type { Entitlement } from './contract';

const ent = (over: Partial<Entitlement> & { used: number; limit: number; resetsAt?: number }): Entitlement => ({
  plan: 'pro',
  active: true,
  ai: { used: over.used, limit: over.limit, resetsAt: over.resetsAt },
  ...(over.plan ? { plan: over.plan } : {}),
  ...(over.active === false ? { active: false } : {}),
});

test('an untouched budget says nothing', () => {
  expect(quotaLevel(ent({ used: 0, limit: 10000 }))).toBe('ok');
  expect(quotaNotice(ent({ used: 0, limit: 10000 }), true)).toBeNull();
});

test('the warning starts exactly at the threshold, not before', () => {
  const limit = 10000;
  const at = limit * QUOTA_WARN_AT;
  expect(quotaLevel(ent({ used: at - 1, limit }))).toBe('ok');
  expect(quotaLevel(ent({ used: at, limit }))).toBe('warn');
});

test('a spent budget is distinct from a nearly-spent one', () => {
  expect(quotaLevel(ent({ used: 9999, limit: 10000 }))).toBe('warn');
  expect(quotaLevel(ent({ used: 10000, limit: 10000 }))).toBe('spent');
  expect(quotaLevel(ent({ used: 10001, limit: 10000 }))).toBe('spent'); // a weighted charge can overshoot
});

test('no plan is the paywall talking, not the quota', () => {
  // Without this the signed-out/free case would shout "budget spent" at someone who never had one.
  expect(quotaLevel({ plan: 'free', active: false, ai: { used: 0, limit: 0 } })).toBe('ok');
  expect(quotaLevel(null)).toBe('ok');
});

test('the warning names how much is left', () => {
  const n = quotaNotice(ent({ used: 8200, limit: 10000 }), true);
  expect(n?.level).toBe('warn');
  expect(n?.text).toContain('1800');
});

test('a spent Pro budget names the reset date', () => {
  const resetsAt = Date.UTC(2026, 9, 14); // 14 October 2026
  const n = quotaNotice(ent({ used: 10000, limit: 10000, resetsAt }), true);
  expect(n?.level).toBe('spent');
  expect(n?.text).toMatch(/октябр/); // "обновятся 14 октября"
  expect(n?.text).toContain('свой ключ');
});

test('a spent trial says one-time instead of inventing a reset', () => {
  // The trial budget never rolls over — promising a reset date would be a lie.
  const n = quotaNotice({ plan: 'trial', active: true, ai: { used: 1000, limit: 1000 } }, true);
  expect(n?.text).toContain('один раз');
  expect(n?.text).not.toMatch(/Обновятся/);
});

test('both notices promise that word translation survives', () => {
  // It does: the reader falls back to the free MyMemory path, so the page stays usable.
  const pro = quotaNotice(ent({ used: 10000, limit: 10000, resetsAt: Date.now() }), true);
  const trial = quotaNotice({ plan: 'trial', active: true, ai: { used: 1000, limit: 1000 } }, true);
  expect(pro?.text).toContain('Перевод слов продолжает работать');
  expect(trial?.text).toContain('Перевод слов продолжает работать');
});

test('a spent budget also closes the managed AI path', () => {
  // The notice and the gate must agree, or the UI says "spent" while calls keep being attempted.
  expect(hasManagedAi(ent({ used: 10000, limit: 10000 }))).toBe(false);
  expect(hasManagedAi(ent({ used: 9999, limit: 10000 }))).toBe(true);
});

test('English is offered too, for both shapes', () => {
  const pro = quotaNotice(ent({ used: 10000, limit: 10000, resetsAt: Date.UTC(2026, 9, 14) }), false);
  expect(pro?.text).toContain('resets on');
  const trial = quotaNotice({ plan: 'trial', active: true, ai: { used: 1000, limit: 1000 } }, false);
  expect(trial?.text).toContain('grants 1000 units once');
});
