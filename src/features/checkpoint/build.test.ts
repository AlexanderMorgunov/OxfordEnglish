import { test, expect } from 'vitest';
import type { LoadedPack } from '@/content/loader';
import { buildCheckpoint, buildLevelExit, reviewPlan } from './build';

function ex(id: string) {
  return { type: 'gap-fill', id, instruction: { en: '', ru: '' }, tags: ['t'], prompt: '_', answers: ['x'] };
}

function day(id: string, level: string, n: number) {
  return {
    id,
    level,
    sections: [{ type: 'practice', id: `${id}.p`, title: { en: '', ru: '' }, exercises: Array.from({ length: n }, (_, i) => ex(`${id}.e${i}`)) }],
  };
}

const pack = {
  units: [
    { id: 'u01', days: [day('u01.d1', 'A2', 8)] },
    { id: 'u15', days: [day('u15.d1', 'B1', 8), day('u15.d2', 'B1', 8)] },
    { id: 'u16', days: [day('u16.d1', 'B1', 8)] },
  ],
} as unknown as LoadedPack;

test('buildLevelExit draws only from the requested level', () => {
  const out = buildLevelExit(pack, 'B1', 12);
  expect(out.length).toBe(12);
  expect(out.every((e) => e.id.startsWith('u15') || e.id.startsWith('u16'))).toBe(true);
  expect(out.some((e) => e.id.startsWith('u01'))).toBe(false);
});

test('buildLevelExit spreads across units and caps at the pool size', () => {
  const out = buildLevelExit(pack, 'B1', 100);
  expect(out.length).toBe(24); // 8 + 8 + 8, nothing invented
  expect(new Set(out.map((e) => e.id)).size).toBe(24); // no duplicates
});

test('buildLevelExit returns empty for a level with no days', () => {
  expect(buildLevelExit(pack, 'C1', 12)).toEqual([]);
});

test('the first checkpoint contains only its own unit and never future material', () => {
  const out = buildCheckpoint(pack, 'u01');
  expect(out).toHaveLength(8);
  expect(out.every(e => e.id.startsWith('u01.'))).toBe(true);
});

test('checkpoint interleaving follows course order rather than unit names', () => {
  const ordered = { ...pack, units: [...pack.units.slice(2), ...pack.units.slice(0, 2)] };
  const out = buildCheckpoint(ordered, 'u01', 8);
  expect(out).toHaveLength(8);
  expect(out.filter(e => e.id.startsWith('u16.'))).toHaveLength(2);
  expect(out.some(e => e.id.startsWith('u15.'))).toBe(false);
  expect(new Set(out.map(e => e.id)).size).toBe(out.length);
});

test('an unknown checkpoint does not become a test drawn from the whole course', () => {
  expect(buildCheckpoint(pack, 'missing')).toEqual([]);
});

test('checkpoint review recommendations do not send beginners to future units', () => {
  expect(reviewPlan(pack, ['t'], 'u01')).toEqual([{ tag: 't', dayIds: ['u01.d1'] }]);
  expect(reviewPlan(pack, ['t'], 'missing')).toEqual([{ tag: 't', dayIds: [] }]);
});
