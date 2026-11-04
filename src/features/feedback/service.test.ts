import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import {
  FEEDBACK_TIMEOUT,
  feedbackIdentity,
  flushFeedback,
  readPendingFeedback,
  retryFeedback,
  submitFeedback,
  subscribeFeedbackDelivery,
} from './service';
import type { FeedbackContext, FeedbackInput } from './service';

vi.mock('./config', () => ({
  FEEDBACK_ENDPOINT: '',
  WEB3FORMS_ACCESS_KEY: 'test-public-key',
}));
const input: FeedbackInput = {
  category: 'broken',
  text: ' Audio in lesson A2 will not play. ',
  email: ' reader@example.com ',
};
const context: FeedbackContext = {
  page: '/feedback',
  lang: 'en',
  level: 'A2',
  online: true,
  version: 'test',
  userAgent: 'Test browser',
};
const response = (success: boolean) =>
  new Response(JSON.stringify({ success }), { status: 200 });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

beforeEach(async () => {
  vi.restoreAllMocks();
  invalidateDataScope();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(true)));
  await db.open();
  await db.feedbackOutbox.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('does not report saved or send when the durable write fails', async () => {
  vi.spyOn(db.feedbackOutbox, 'add').mockRejectedValueOnce(
    new Error('Quota exceeded')
  );
  await expect(submitFeedback(input, context)).rejects.toThrow(
    'Quota exceeded'
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(await db.feedbackOutbox.count()).toBe(0);
});

test('requires the real provider acknowledgement, trims input, and sends only the declared context', async () => {
  const listener = vi.fn(),
    unsubscribe = subscribeFeedbackDelivery(listener);
  const result = await submitFeedback(input, context);
  expect(result.status).toBe('sent');
  expect(await db.feedbackOutbox.count()).toBe(0);
  const request = vi.mocked(fetch).mock.calls[0]?.[1];
  const body = JSON.parse(String(request?.body));
  expect(body).toEqual({
    access_key: 'test-public-key',
    subject: 'Feedback: Something is broken',
    category: 'Something is broken',
    message: input.text.trim(),
    email: input.email.trim(),
    app_version: 'test',
    page: '/feedback',
    ui_language: 'en',
    level: 'A2',
    user_agent: 'Test browser',
    online_at_submit: true,
    submission_id: result.item.submissionId,
  });
  expect(listener).toHaveBeenCalledWith(result.item.submissionId);
  unsubscribe();
});

test.each([
  response(false),
  new Response('{}'),
  new Response('not json'),
  new Response('{}', { status: 429 }),
  new Response('{}', { status: 503 }),
])(
  'does not confuse HTTP or malformed provider responses with delivery',
  async (res) => {
    vi.mocked(fetch).mockResolvedValue(res);
    const result = await submitFeedback(input, context);
    expect(result).toMatchObject({ status: 'queued', reason: 'unavailable' });
    expect(await db.feedbackOutbox.count()).toBe(1);
    expect((await readPendingFeedback())[0]?.body.message).toBe(
      input.text.trim()
    );
  }
);

test('offline queues durably and retry uses the same row and original payload', async () => {
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });
  const result = await submitFeedback(input, { ...context, online: false });
  expect(result).toMatchObject({ status: 'queued', reason: 'offline' });
  expect(fetch).not.toHaveBeenCalled();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  const retried = await retryFeedback(result.item);
  expect(retried.status).toBe('sent');
  expect(retried.item.id).toBe(result.item.id);
  expect(retried.item.body.online_at_submit).toBe(false);
  expect(await db.feedbackOutbox.count()).toBe(0);
});

test('parallel manual and background attempts acquire one lease, including identical submissions', async () => {
  const request = deferred<Response>();
  vi.mocked(fetch).mockReturnValue(request.promise);
  const submissionId = crypto.randomUUID();
  const first = submitFeedback(input, context, { submissionId });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const same = await submitFeedback(
    { ...input, text: 'Must not replace original.' },
    context,
    { submissionId }
  );
  expect(same).toMatchObject({ status: 'queued', reason: 'busy' });
  expect(same.item.body.message).toBe(input.text.trim());
  await flushFeedback();
  expect(fetch).toHaveBeenCalledOnce();
  expect(await db.feedbackOutbox.count()).toBe(1);
  request.resolve(response(true));
  expect((await first).status).toBe('sent');
  expect(await db.feedbackOutbox.count()).toBe(0);
  const repeated = await submitFeedback(
    { ...input, text: 'Cannot replace a delivered snapshot.' },
    context,
    { submissionId }
  );
  expect(repeated.status).toBe('sent');
  expect(repeated.item.body.message).toBe(input.text.trim());
  expect(await db.feedbackOutbox.count()).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
});

test('cancelling a slow request leaves one retryable row and ignores late completion', async () => {
  const request = deferred<Response>();
  vi.mocked(fetch).mockReturnValue(request.promise);
  const controller = new AbortController(),
    task = submitFeedback(input, context, { signal: controller.signal });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  controller.abort();
  const result = await task;
  expect(result).toMatchObject({ status: 'queued', reason: 'cancelled' });
  request.resolve(response(true));
  await Promise.resolve();
  expect(await db.feedbackOutbox.count()).toBe(1);
  vi.mocked(fetch).mockResolvedValue(response(true));
  expect((await retryFeedback(result.item)).status).toBe('sent');
  expect(await db.feedbackOutbox.count()).toBe(0);
});

test('a hung transport times out and leaves the durable message available', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  vi.mocked(fetch).mockReturnValue(new Promise(() => {}));
  const task = submitFeedback(input, context);
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(FEEDBACK_TIMEOUT);
  expect(await task).toMatchObject({ status: 'queued', reason: 'timeout' });
  expect(await db.feedbackOutbox.count()).toBe(1);
});

test('cancellation during saving rolls the transaction back', async () => {
  const controller = new AbortController(),
    add = db.feedbackOutbox.add.bind(db.feedbackOutbox);
  vi.spyOn(db.feedbackOutbox, 'add').mockImplementation((...args) =>
    add(...args).then((id) => {
      controller.abort();
      return id;
    })
  );
  await expect(
    submitFeedback(input, context, { signal: controller.signal })
  ).rejects.toThrow();
  expect(await db.feedbackOutbox.count()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});

test('handover during an in-flight attempt cannot delete or recreate another owner’s row', async () => {
  const request = deferred<Response>();
  vi.mocked(fetch).mockReturnValue(request.promise);
  const task = submitFeedback(input, context);
  const rejected = expect(task).rejects.toThrow('Data owner changed');
  await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const first = (await readPendingFeedback())[0]!;
  invalidateDataScope();
  await db.feedbackOutbox.clear();
  await db.feedbackOutbox.put({
    id: first.id,
    body: { message: 'New owner private text' },
    createdAt: 999,
    submissionId: 'new-owner',
  });
  request.resolve(response(true));
  await rejected;
  expect((await db.feedbackOutbox.get(first.id))?.body.message).toBe(
    'New owner private text'
  );
});

test('a missing row is not falsely described as queued or sent', async () => {
  await expect(
    retryFeedback({ id: 99, body: { message: 'Missing' }, createdAt: 1 })
  ).rejects.toThrow('no longer available');
  expect(fetch).not.toHaveBeenCalled();
});

test('a delivery acknowledgement survives a failed deletion and prevents a second send', async () => {
  const remove = vi
    .spyOn(db.feedbackOutbox, 'delete')
    .mockRejectedValueOnce(new Error('Storage failure'));
  const result = await submitFeedback(input, context);
  expect(result).toMatchObject({ status: 'sent', cleanupFailed: true });
  expect((await db.feedbackOutbox.get(result.item.id))?.deliveryConfirmed).toBe(
    true
  );
  expect(await readPendingFeedback()).toEqual([]);
  remove.mockRestore();
  await flushFeedback();
  expect(await db.feedbackOutbox.count()).toBe(0);
  expect(fetch).toHaveBeenCalledOnce();
});

test('a failure after persistence still reports the real saved row', async () => {
  vi.spyOn(db.feedbackOutbox, 'get').mockRejectedValueOnce(
    new Error('Read failed')
  );
  const result = await submitFeedback(input, context);
  expect(result).toMatchObject({ status: 'queued', reason: 'storage-error' });
  expect(await db.feedbackOutbox.count()).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('flush can deliver legacy rows without inventing context or making a duplicate', async () => {
  const id = await db.feedbackOutbox.add({
    body: { message: 'A legacy feedback message', page: '/reader' },
    createdAt: 1,
  });
  expect(feedbackIdentity({ id: id!, body: {}, createdAt: 1 })).toBe(
    `legacy-${id}-1`
  );
  await flushFeedback();
  expect(fetch).toHaveBeenCalledOnce();
  expect(await db.feedbackOutbox.count()).toBe(0);
});

test('owner changes during acknowledgement persistence cannot publish a stale success', async () => {
  const put = db.feedbackOutbox.put.bind(db.feedbackOutbox),
    delivered = vi.fn();
  const unsubscribe = subscribeFeedbackDelivery(delivered);
  vi.spyOn(db.feedbackOutbox, 'put').mockImplementation((...args) =>
    put(...args).then((id) => {
      if (args[0].deliveryConfirmed) invalidateDataScope();
      return id;
    })
  );
  await expect(submitFeedback(input, context)).rejects.toThrow(
    'Data owner changed'
  );
  expect(delivered).not.toHaveBeenCalled();
  unsubscribe();
});
