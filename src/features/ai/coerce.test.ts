import { test, expect } from 'vitest';
import { coerceExercises } from './functions';

test('coerceExercises builds choice exercises from clean JSON', () => {
  const raw = JSON.stringify([
    { q: 'The ___ was dark.', options: ['forest', 'river', 'house', 'road'], answer: 'forest' },
  ]);
  const ex = coerceExercises(raw, 'reader.b.0');
  expect(ex.length).toBe(1);
  expect(ex[0]!.type).toBe('choice');
  expect(ex[0]!.id).toBe('reader.b.0.ai.0');
  if (ex[0]!.type === 'choice') {
    expect(ex[0]!.options[ex[0]!.correctIndex]).toBe('forest');
    expect(ex[0]!.tags).toContain('reader.vocab');
  }
});

test('coerceExercises tolerates prose/markdown around the array', () => {
  const raw = 'Sure! Here you go:\n```json\n[{"q":"A ___ ran.","options":["dog","cat"],"answer":"dog"}]\n```';
  expect(coerceExercises(raw, 'x').length).toBe(1);
});

test('coerceExercises drops malformed items', () => {
  const raw = JSON.stringify([
    { q: 'no blank here', options: ['a', 'b'], answer: 'a' }, // no ___
    { q: 'A ___ .', options: ['a'], answer: 'a' }, // too few options
    { q: 'A ___ .', options: ['a', 'b'], answer: 'z' }, // answer not in options
    { q: 'A ___ .', options: ['a', 'b'], answer: 'b' }, // valid
  ]);
  expect(coerceExercises(raw, 'x').length).toBe(1);
});

test('coerceExercises returns empty on non-JSON', () => {
  expect(coerceExercises('the model refused', 'x')).toEqual([]);
  expect(coerceExercises('{"not":"an array"}', 'x')).toEqual([]);
});
