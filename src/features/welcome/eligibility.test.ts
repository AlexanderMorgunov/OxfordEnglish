import { beforeEach, expect, test, vi } from 'vitest';
const counts = vi.hoisted(() => ({ value: 0, fail: false }));
vi.mock('@/db/db', () => ({
  db: Object.fromEntries(
    [
      'attempts',
      'wordStatus',
      'srsCards',
      'checkpoints',
      'books',
      'bookmarks',
      'activity',
      'reviewLog',
      'feedbackOutbox',
    ].map((key) => [
      key,
      {
        count: async () => {
          if (counts.fail) throw new Error('Unavailable');
          return counts.value;
        },
      },
    ])
  ),
}));
import { newInstallation, welcomeEntry } from './eligibility';
import { WELCOME_KEY } from './memory';
beforeEach(() => {
  localStorage.clear();
  counts.value = 0;
  counts.fail = false;
});
test('a new anonymous device record does not suppress the first welcome', async () => {
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({
      accountId: '',
      refreshToken: '',
      deviceId: 'fixture-device',
    })
  );
  expect(await newInstallation()).toBe(true);
  expect(localStorage.getItem(WELCOME_KEY)).toBeNull();
});
test.each([
  'onboarding.seen',
  'oxford-appearance',
  'oxford-ui-text-size',
  'reader.catalog.alice.pos.0',
  'dayenglish-contextual-tour:v1:local:reader',
])(
  'existing %s prevents a new default without marking the welcome as seen',
  async (key) => {
    localStorage.setItem(key, 'existing');
    expect(await newInstallation()).toBe(false);
    expect(localStorage.getItem(key)).toBe('existing');
    expect(localStorage.getItem(WELCOME_KEY)).toBeNull();
  }
);
test('signed out ownership and data-only history count as existing use', async () => {
  localStorage.setItem(
    'oxford-account',
    JSON.stringify({ accountId: '', dataOwner: 'fixture-owner' })
  );
  expect(await newInstallation()).toBe(false);
  localStorage.clear();
  counts.value = 1;
  expect(await newInstallation()).toBe(false);
});
test('unreadable history never overwrites an existing user with a new default', async () => {
  counts.fail = true;
  expect(await newInstallation()).toBe(false);
});
test('welcome is deferred on legal, billing, account and marketing routes', () => {
  for (const path of [
    '/',
    '/library/catalog/alice',
    '/course/u00/day/u00.d01',
    '/vocabulary',
    '/settings/interface',
    '/progress',
    '/syllabus',
  ])
    expect(welcomeEntry(path)).toBe(true);
  for (const path of [
    '/account/register',
    '/billing/success',
    '/privacy',
    '/pro',
    '/about',
  ])
    expect(welcomeEntry(path)).toBe(false);
});
