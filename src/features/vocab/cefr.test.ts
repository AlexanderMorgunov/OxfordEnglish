import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cefrOf, indexCefr } from './cefr';
import type { LemmaData } from './lemma';

const asset = JSON.parse(readFileSync(resolve(process.cwd(), 'public/reader/en-cefr.json'), 'utf8')) as {
  levels: string[][];
};
const data = indexCefr(asset.levels);
const lemma: LemmaData = { byForm: new Map([['went', 'go']]), lemmas: new Set(['go']) };
const level = (w: string, l?: LemmaData) => cefrOf(w, data, l)?.level ?? null;

describe('en-cefr.json', () => {
  it('has all four levels, each word once', () => {
    expect(asset.levels).toHaveLength(4);
    for (const words of asset.levels) expect(words.length).toBeGreaterThan(900);
    const all = asset.levels.flat();
    expect(new Set(all).size).toBe(all.length);
  });

  it('splits spelling variants and keeps multiword headwords', () => {
    expect(level('a.m.')).toBe(0);
    expect(level('am')).toBe(0);
    expect(level('according to')).toBe(2);
  });
});

describe('cefrOf', () => {
  it('rates an inflection as its easiest base', () => {
    expect(level('go')).toBe(0);
    expect(level('went', lemma)).toBe(0);
    expect(level('Cities')).toBe(level('city'));
    expect(level('abandoned')).toBe(level('abandon'));
  });

  it('ranks more frequent words first within a level', () => {
    expect(cefrOf('go', data)!.order).toBeLessThan(cefrOf('abandon', data)!.order);
  });

  it('matches phrases exactly and returns null for unlisted terms', () => {
    expect(level('according')).not.toBe(2);
    expect(level('xyzzy')).toBeNull();
    expect(level('look daggers at')).toBeNull();
  });
});
