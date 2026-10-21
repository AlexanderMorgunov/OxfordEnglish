import { beforeEach, expect, test, vi } from 'vitest';
import { recordSessionEvent, sessionDiagnostics, sessionRejectionReason } from './session-diagnostics';

beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); });

test('diagnostics are bounded and expose only allowed event, time and build', () => {
  for (let i = 0; i < 40; i += 1) recordSessionEvent('refresh_network');
  const rows = sessionDiagnostics();
  expect(rows).toHaveLength(20);
  for (const row of rows) {
    expect(Object.keys(row).sort()).toEqual(['build', 'event', 'time']);
    expect(row).toMatchObject({ event: 'refresh_network', build: __APP_VERSION__ });
    expect(Number.isFinite(row.time)).toBe(true);
  }
});

test('untrusted stored records cannot expose arbitrary values or extra credential fields', () => {
  localStorage.setItem('oxford-session-diagnostics', JSON.stringify([
    { event: 'refresh_invalid', time: 1, build: '1.0.0', token: 'synthetic-secret', accountId: 'synthetic-owner' },
    { event: 'synthetic-secret', time: 1, build: '1.0.0' },
    { event: 'refresh_invalid', time: null, build: '1.0.0' },
    { event: 'refresh_invalid', time: 1, build: 'synthetic-secret' },
    null,
  ]));
  expect(sessionDiagnostics()).toEqual([{ event: 'refresh_invalid', time: 1, build: '1.0.0' }]);
  recordSessionEvent('refresh_network');
  expect(localStorage.getItem('oxford-session-diagnostics')).not.toContain('synthetic-');
});

test('a rejection reason remains available until explicit sign-out or a new accepted session', () => {
  recordSessionEvent('refresh_invalid');
  recordSessionEvent('session_absent');
  expect(sessionRejectionReason()).toBe('refresh_invalid');
  recordSessionEvent('authenticated');
  expect(sessionRejectionReason()).toBeNull();
  recordSessionEvent('refresh_reused');
  expect(sessionRejectionReason()).toBe('refresh_reused');
  recordSessionEvent('signed_out');
  expect(sessionRejectionReason()).toBeNull();
});

test('damaged, oversized and inaccessible diagnostics do not interrupt account actions', () => {
  for (const raw of ['{', 'null', ' '.repeat(16_385)]) {
    localStorage.setItem('oxford-session-diagnostics', raw);
    expect(sessionDiagnostics()).toEqual([]);
    expect(() => recordSessionEvent('refresh_failed')).not.toThrow();
  }
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('synthetic-only'); });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('synthetic-only'); });
  expect(() => recordSessionEvent('refresh_failed')).not.toThrow();
  expect(sessionRejectionReason()).toBeNull();
});
