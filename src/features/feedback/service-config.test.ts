import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { initFeedback, submitFeedback } from './service';

const config = vi.hoisted(() => ({
  FEEDBACK_ENDPOINT: '',
  WEB3FORMS_ACCESS_KEY: '',
}));
vi.mock('./config', () => config);
beforeEach(async () => {
  invalidateDataScope();
  config.FEEDBACK_ENDPOINT = '';
  config.WEB3FORMS_ACCESS_KEY = '';
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(new Response('', { status: 202 }))
  );
  await db.open();
  await db.feedbackOutbox.clear();
});
afterEach(() => vi.unstubAllGlobals());
const input = {
  category: 'idea',
  text: 'A new feedback idea.',
  email: '',
} as const;
const context = {
  page: '/feedback',
  lang: 'en',
  level: 'A2',
  online: true,
  version: 'test',
  userAgent: 'test',
};

test('an unconfigured transport retains a durable queued message with an explicit reason', async () => {
  expect(await submitFeedback(input, context)).toMatchObject({
    status: 'queued',
    reason: 'not-configured',
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await db.feedbackOutbox.count()).toBe(1);
});
test('the configured endpoint keeps priority and its existing 2xx acknowledgement contract', async () => {
  config.FEEDBACK_ENDPOINT = 'https://feedback.example.test/submit';
  config.WEB3FORMS_ACCESS_KEY = 'test-public-key';
  expect((await submitFeedback(input, context)).status).toBe('sent');
  expect(fetch).toHaveBeenCalledWith(
    config.FEEDBACK_ENDPOINT,
    expect.objectContaining({ method: 'POST' })
  );
  expect(String(vi.mocked(fetch).mock.calls[0]?.[1]?.body)).not.toContain(
    'access_key'
  );
});
test('startup still works if cross-tab notifications are unavailable or denied', () => {
  vi.stubGlobal(
    'BroadcastChannel',
    class {
      constructor() {
        throw new Error('Denied');
      }
    }
  );
  expect(() => initFeedback()).not.toThrow();
});
