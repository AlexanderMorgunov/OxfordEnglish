import { beforeEach, expect, test, vi } from 'vitest';
import { PageLoadError, pageDiagnostics, recordPageError } from './page-diagnostics';

const KEY = 'oxford-page-diagnostics';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.removeItem(KEY);
});

test.each([
  ['/library/private-title?key=secret#passage', '/library/:bookId'],
  ['/library/catalog/private-title', '/library/catalog/:catalogId'],
  ['/course/private/day/secret', '/course/:unitId/day/:dayId'],
  ['/grammar/private', '/grammar/:articleId'],
  ['/checkpoint/private', '/checkpoint/:unitId'],
  ['/unknown/private', '/unknown'],
  ['/progress/', '/progress'],
])('diagnostics redact route parameters and never store raw exceptions (%s)', (path, route) => {
  const error = new TypeError('API key=secret book passage');
  error.stack = 'private stack';
  error.cause = 'private cause';
  recordPageError(error, path);
  const [event] = pageDiagnostics();
  expect(event).toMatchObject({ name: 'TypeError', route, kind: 'page_render', version: __APP_VERSION__, build: __APP_BUILD__ });
  expect(Object.keys(event!)).toEqual(['kind', 'name', 'route', 'platform', 'time', 'version', 'build']);
  expect(localStorage.getItem(KEY)).not.toMatch(/secret|passage|private|stack|cause/);
});

test('bounded sanitized history removes extras and rejects tampered fields', () => {
  const good = recordPageError(new Error(), '/library');
  localStorage.setItem(KEY, JSON.stringify([{ ...good, message: 'secret' }, { ...good, name: 'secret' }, { ...good, route: '/library/private' }, { ...good, build: 'secret' }]));
  expect(pageDiagnostics()).toEqual([good]);
  for (let n = 0; n < 20; n++) recordPageError(new Error(), '/progress');
  expect(pageDiagnostics()).toHaveLength(10);
  expect(localStorage.getItem(KEY)).not.toContain('secret');
  localStorage.setItem(KEY, ' '.repeat(8193));
  expect(pageDiagnostics()).toEqual([]);
});

test('storage failures and hostile exception getters cannot break recording', () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
  const error = new Error();
  Object.defineProperty(error, 'name', { get: () => { throw new Error('secret'); } });
  expect(recordPageError(error, '/settings')).toMatchObject({ name: 'Unknown', route: '/settings' });
  expect(pageDiagnostics()).toEqual([]);
  const proxy = new Proxy({}, { getPrototypeOf: () => { throw new Error('secret'); } });
  expect(recordPageError(proxy)).toMatchObject({ name: 'Unknown', kind: 'page_render' });
});

test('page loading marker preserves only an allowlisted failure name', () => {
  const marked = new PageLoadError(new TypeError('private file URL and query'));
  expect(recordPageError(marked, '/library')).toMatchObject({ kind: 'page_load', name: 'TypeError' });
  expect(marked.cause).toBeUndefined();
  expect(marked.message).not.toContain('private');
});
