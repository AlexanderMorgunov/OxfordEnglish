/**
 * robots.txt and the loader have to agree, and nothing in the type system makes them.
 *
 * /grammar and its 48 topic pages are indexable and render from exactly one pack file. While robots.txt
 * blocked it, Googlebot's renderer could not fetch it and indexed every one of those pages as "article
 * not found". Renaming or moving the file without touching robots.txt would restore that silently —
 * the app would keep working for humans and break only for crawlers, where nobody looks.
 */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { GRAMMAR_URL, PUBLIC_PACK_BASE } from './loader';

const robots = readFileSync('public/robots.txt', 'utf8');
const lines = robots
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'));

test('the pack is closed to crawlers', () => {
  expect(lines).toContain(`Disallow: ${PUBLIC_PACK_BASE.split('/').slice(0, 2).join('/')}/`);
});

test('the grammar reference is opened by name', () => {
  expect(lines).toContain(`Allow: ${GRAMMAR_URL}`);
});

test('the rule that opens it is the more specific one, so it wins', () => {
  const allow = lines.find((l) => l.startsWith('Allow: /packs/'))?.slice('Allow: '.length) ?? '';
  const disallow = lines.find((l) => l.startsWith('Disallow: /packs'))?.slice('Disallow: '.length) ?? '';
  expect(allow.startsWith(disallow)).toBe(true);
  expect(allow.length).toBeGreaterThan(disallow.length);
});

test('opening it did not open the learning days or the media', () => {
  const opened = lines.filter((l) => l.startsWith('Allow: /packs/'));
  expect(opened).toEqual([`Allow: ${GRAMMAR_URL}`]);
});
