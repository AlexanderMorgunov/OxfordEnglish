import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { adoptTourMemory, readTour, rememberTour, tourOwner } from './memory';
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

test('new per-page memory preserves old onboarding and completion across reopening', () => {
  localStorage.setItem('onboarding.seen', '1');
  expect(readTour('local', 'reader')).toBeNull();
  rememberTour('local', 'reader', 'shown');
  expect(readTour('local', 'lesson')).toBeNull();
  rememberTour('local', 'reader', 'completed');
  rememberTour('local', 'reader', 'dismissed');
  expect(readTour('local', 'reader')).toBe('completed');
  expect(localStorage.getItem('onboarding.seen')).toBe('1');
});
test('account owners stay distinct, while ordinary logout retains the same data owner', () => {
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: 'owner-a', dataOwner: 'owner-a' })
  );
  const owner = tourOwner();
  rememberTour(owner, 'reader', 'shown');
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: '', dataOwner: 'owner-a' })
  );
  expect(tourOwner()).toBe(owner);
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: 'owner-b', dataOwner: 'owner-b' })
  );
  expect(readTour(tourOwner(), 'reader')).toBeNull();
  expect(readTour(owner, 'reader')).toBe('shown');
});
test('adopting anonymous work carries only tour memory without overwriting account completion', () => {
  rememberTour('local', 'reader', 'dismissed');
  rememberTour('local', 'lesson', 'shown');
  rememberTour('account', 'reader', 'completed');
  adoptTourMemory('local', 'account');
  expect(readTour('account', 'reader')).toBe('completed');
  expect(readTour('account', 'lesson')).toBe('shown');
});
test('blocked or corrupted storage disables auto without claiming completion', () => {
  localStorage.setItem('dayenglish-contextual-tour:v1:local:reader', '{broken');
  expect(readTour('local', 'reader')).toBe('unavailable');
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  expect(rememberTour('local', 'lesson', 'shown')).toBe(false);
  expect(readTour('local', 'lesson')).toBeNull();
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Denied');
  });
  expect(readTour('local', 'lesson')).toBe('unavailable');
});
