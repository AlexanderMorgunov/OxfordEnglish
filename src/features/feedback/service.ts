import { db } from '@/db/db';
import type { FeedbackOutboxItem } from '@/db/db';
import {
  captureDataScope,
  requireDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { FEEDBACK_ENDPOINT, WEB3FORMS_ACCESS_KEY } from './config';

export type FeedbackCategory = 'broken' | 'lesson-error' | 'idea' | 'other';
export type FeedbackContext = {
  page: string;
  lang: string;
  level: string;
  online: boolean;
  version: string;
  userAgent: string;
};
export type FeedbackInput = {
  category: FeedbackCategory;
  text: string;
  email: string;
};
export type FeedbackReason =
  | 'offline'
  | 'unavailable'
  | 'not-configured'
  | 'cancelled'
  | 'timeout'
  | 'busy'
  | 'storage-error';
export type FeedbackItem = FeedbackOutboxItem & {
  id: number;
  submissionId: string;
};
export type SubmitResult = {
  status: 'sent' | 'queued';
  item: FeedbackItem;
  reason?: FeedbackReason;
  cleanupFailed?: boolean;
};
export type FeedbackOptions = {
  signal?: AbortSignal;
  current?: () => boolean;
  submissionId?: string;
};
export const FEEDBACK_TIMEOUT = 20000;
const LEASE_MS = 60000;
const EVENT = 'dayenglish:feedback-delivery';
const acknowledged = new Set<string>();
const deliveredSnapshots = new Map<string, FeedbackItem>();
const controllers = new Set<AbortController>();
let channel: BroadcastChannel | null = null;

export const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  broken: 'Something is broken',
  'lesson-error': 'Mistake in a lesson',
  idea: 'Idea',
  other: 'Other',
};
export function feedbackConfigured(): boolean {
  return FEEDBACK_ENDPOINT !== '' || WEB3FORMS_ACCESS_KEY !== '';
}
export function collectContext(
  page: string,
  lang: string,
  level: string
): FeedbackContext {
  return {
    page,
    lang,
    level,
    online: navigator.onLine,
    version: __APP_VERSION__,
    userAgent: navigator.userAgent,
  };
}
export function feedbackBody(
  input: FeedbackInput,
  ctx: FeedbackContext,
  submissionId: string
): FeedbackItem['body'] {
  return {
    subject: `Feedback: ${CATEGORY_LABEL[input.category]}`,
    category: CATEGORY_LABEL[input.category],
    message: input.text.trim(),
    email: input.email.trim(),
    app_version: ctx.version,
    page: ctx.page,
    ui_language: ctx.lang,
    level: ctx.level,
    user_agent: ctx.userAgent,
    online_at_submit: ctx.online,
    submission_id: submissionId,
  };
}
export function subscribeFeedbackDelivery(
  listener: (submissionId: string) => void
): () => void {
  const receive = (event: Event) => {
    if (event instanceof CustomEvent && typeof event.detail === 'string')
      listener(event.detail);
  };
  window.addEventListener(EVENT, receive);
  return () => window.removeEventListener(EVENT, receive);
}
function announce(submissionId: string, broadcast = true, item?: FeedbackItem) {
  if (item) deliveredSnapshots.set(submissionId, item);
  acknowledged.add(submissionId);
  if (acknowledged.size > 200) {
    const oldest = acknowledged.values().next().value!;
    acknowledged.delete(oldest);
    deliveredSnapshots.delete(oldest);
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: submissionId }));
  if (broadcast) channel?.postMessage(submissionId);
}
subscribeDataScope((change) => {
  for (const controller of controllers) controller.abort();
  if (change === 'reset') {
    acknowledged.clear();
    deliveredSnapshots.clear();
  }
});

export function feedbackIdentity(
  item: FeedbackOutboxItem & { id: number }
): string {
  return item.submissionId ?? `legacy-${item.id}-${item.createdAt}`;
}

async function deliver(
  body: FeedbackItem['body'],
  outer?: AbortSignal
): Promise<{ sent: boolean; reason?: FeedbackReason }> {
  if (outer?.aborted) return { sent: false, reason: 'cancelled' };
  if (!navigator.onLine) return { sent: false, reason: 'offline' };
  if (!feedbackConfigured()) return { sent: false, reason: 'not-configured' };
  const controller = new AbortController();
  controllers.add(controller);
  let reason: FeedbackReason = 'cancelled';
  const cancel = () => controller.abort();
  outer?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => {
    reason = 'timeout';
    controller.abort();
  }, FEEDBACK_TIMEOUT);
  const aborted = new Promise<never>((_, reject) =>
    controller.signal.addEventListener(
      'abort',
      () => reject(new Error('Feedback attempt stopped')),
      { once: true }
    )
  );
  try {
    const send = async () => {
      const response = await fetch(
        FEEDBACK_ENDPOINT || 'https://api.web3forms.com/submit',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            accept: 'application/json',
          },
          signal: controller.signal,
          body: JSON.stringify(
            FEEDBACK_ENDPOINT
              ? body
              : { access_key: WEB3FORMS_ACCESS_KEY, ...body }
          ),
        }
      );
      if (!response.ok) return false;
      if (FEEDBACK_ENDPOINT) return true;
      const data: unknown = await response.json();
      return Boolean(
        data &&
        typeof data === 'object' &&
        'success' in data &&
        data.success === true
      );
    };
    const sent = await Promise.race([send(), aborted]);
    return sent ? { sent: true } : { sent: false, reason: 'unavailable' };
  } catch {
    return {
      sent: false,
      reason: controller.signal.aborted
        ? reason
        : navigator.onLine
          ? 'unavailable'
          : 'offline',
    };
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener('abort', cancel);
    controllers.delete(controller);
  }
}

export async function submitFeedback(
  input: FeedbackInput,
  ctx: FeedbackContext,
  options: FeedbackOptions = {}
): Promise<SubmitResult> {
  const current = options.current ?? captureDataScope(),
    submissionId = options.submissionId ?? crypto.randomUUID();
  const active = () => current() && !options.signal?.aborted;
  const body = feedbackBody(input, ctx, submissionId);
  if (acknowledged.has(submissionId)) {
    requireDataScope(active);
    return {
      status: 'sent',
      item: deliveredSnapshots.get(submissionId) ?? {
        id: -1,
        submissionId,
        body,
        createdAt: Date.now(),
      },
    };
  }
  const item = await db.transaction('rw', db.feedbackOutbox, async () => {
    requireDataScope(active);
    const existing = await db.feedbackOutbox
      .filter((row) => row.submissionId === submissionId)
      .first();
    requireDataScope(active);
    if (existing?.id != null)
      return { ...existing, id: existing.id, submissionId };
    const row = { body, createdAt: Date.now(), submissionId };
    const id = await db.feedbackOutbox.add(row);
    if (id == null) throw new Error('Feedback was not saved');
    requireDataScope(active);
    return { ...row, id };
  });
  try {
    return await retryFeedback(item, { ...options, current });
  } catch {
    requireDataScope(current);
    if (acknowledged.has(submissionId)) return { status: 'sent', item };
    return { status: 'queued', item, reason: 'storage-error' };
  }
}

export async function retryFeedback(
  source: FeedbackOutboxItem & { id: number },
  options: FeedbackOptions = {}
): Promise<SubmitResult> {
  const current = options.current ?? captureDataScope(),
    attemptId = crypto.randomUUID();
  const identity = feedbackIdentity(source);
  const item: FeedbackItem = { ...source, submissionId: identity };
  requireDataScope(current);
  if (acknowledged.has(identity) || item.deliveryConfirmed)
    return { status: 'sent', item: deliveredSnapshots.get(identity) ?? item };
  if (options.signal?.aborted)
    return { status: 'queued', item, reason: 'cancelled' };
  const claim = await db.transaction('rw', db.feedbackOutbox, async () => {
    requireDataScope(current);
    const row = await db.feedbackOutbox.get(source.id);
    requireDataScope(current);
    if (
      !row ||
      row.createdAt !== source.createdAt ||
      (row.submissionId && row.submissionId !== identity)
    ) {
      if (acknowledged.has(identity)) return null;
      throw new Error('Saved feedback is no longer available');
    }
    if (row.deliveryConfirmed)
      return { ...row, id: source.id, submissionId: identity };
    if ((row.leaseUntil ?? 0) > Date.now()) return null;
    const leased: FeedbackItem = {
      ...row,
      id: source.id,
      submissionId: identity,
      leaseOwner: attemptId,
      leaseUntil: Date.now() + LEASE_MS,
    };
    await db.feedbackOutbox.put(leased);
    requireDataScope(current);
    return leased;
  });
  requireDataScope(current);
  if (!claim)
    return acknowledged.has(identity)
      ? { status: 'sent', item }
      : { status: 'queued', item, reason: 'busy' };
  if (claim.deliveryConfirmed) {
    announce(identity, true, claim);
    return { status: 'sent', item: claim };
  }
  const outcome = await deliver(claim.body, options.signal);
  requireDataScope(current);
  if (outcome.sent) {
    let cleanupFailed = false;
    try {
      await db.transaction('rw', db.feedbackOutbox, async () => {
        requireDataScope(current);
        const row = await db.feedbackOutbox.get(source.id);
        requireDataScope(current);
        if (row?.submissionId === identity && row.leaseOwner === attemptId)
          await db.feedbackOutbox.put({
            ...row,
            deliveryConfirmed: true,
            leaseUntil: 0,
            leaseOwner: undefined,
          });
        requireDataScope(current);
      });
      await db.transaction('rw', db.feedbackOutbox, async () => {
        requireDataScope(current);
        const row = await db.feedbackOutbox.get(source.id);
        requireDataScope(current);
        if (row?.submissionId === identity && row.deliveryConfirmed)
          await db.feedbackOutbox.delete(source.id);
        requireDataScope(current);
      });
    } catch {
      cleanupFailed = true;
    }
    requireDataScope(current);
    announce(identity, true, claim);
    return { status: 'sent', item: claim, cleanupFailed };
  }
  await db.transaction('rw', db.feedbackOutbox, async () => {
    requireDataScope(current);
    const row = await db.feedbackOutbox.get(source.id);
    requireDataScope(current);
    if (row?.submissionId === identity && row.leaseOwner === attemptId)
      await db.feedbackOutbox.put({
        ...row,
        leaseUntil: 0,
        leaseOwner: undefined,
      });
    requireDataScope(current);
  });
  return { status: 'queued', item: claim, reason: outcome.reason };
}

export async function readPendingFeedback(): Promise<
  (FeedbackOutboxItem & { id: number })[]
> {
  const current = captureDataScope();
  const rows = await db.feedbackOutbox.orderBy('createdAt').toArray();
  requireDataScope(current);
  return rows.filter(
    (row): row is FeedbackOutboxItem & { id: number } =>
      row.id != null &&
      !row.deliveryConfirmed &&
      !acknowledged.has(feedbackIdentity({ ...row, id: row.id }))
  );
}
let flushing: Promise<void> | null = null;
export function flushFeedback(): Promise<void> {
  if (flushing) return flushing;
  if (!navigator.onLine || !feedbackConfigured()) return Promise.resolve();
  const current = captureDataScope();
  flushing = (async () => {
    try {
      for (const item of await readPendingFeedback()) {
        if (!current()) return;
        const result = await retryFeedback(item, { current });
        if (result.status !== 'sent' && result.reason !== 'busy') break;
      }
      await db.transaction('rw', db.feedbackOutbox, async () => {
        requireDataScope(current);
        await db.feedbackOutbox
          .filter((row) => row.deliveryConfirmed === true)
          .delete();
        requireDataScope(current);
      });
    } catch {
      /* Background delivery is retried on the next launch or connection. */
    } finally {
      flushing = null;
    }
  })();
  return flushing;
}
export async function pendingFeedbackCount(): Promise<number> {
  try {
    return (await readPendingFeedback()).length;
  } catch {
    return 0;
  }
}
let initialized = false;
export function initFeedback(): void {
  if (initialized) return;
  initialized = true;
  if (typeof window.BroadcastChannel === 'function') {
    try {
      channel = new BroadcastChannel(EVENT);
      channel.onmessage = (event) => {
        if (typeof event.data === 'string') announce(event.data, false);
      };
    } catch {
      /* Cross-tab notifications are optional; database leases still coordinate delivery. */
    }
  }
  window.addEventListener('online', () => void flushFeedback());
  void flushFeedback();
}
