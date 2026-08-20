import { db, type FeedbackOutboxItem } from '@/db/db';
import { FEEDBACK_ENDPOINT, WEB3FORMS_ACCESS_KEY } from './config';

export type FeedbackCategory = 'broken' | 'lesson-error' | 'idea' | 'other';

export type FeedbackContext = {
  page: string;
  lang: string;
  level: string;
  online: boolean;
};

export type FeedbackInput = {
  category: FeedbackCategory;
  text: string;
  email: string;
};

export type SubmitResult = 'sent' | 'queued';

const CATEGORY_LABEL: Record<FeedbackCategory, string> = {
  broken: 'Something is broken',
  'lesson-error': 'Mistake in a lesson',
  idea: 'Idea',
  other: 'Other',
};

/** True when there's somewhere to deliver to. With neither set, the form still queues locally. */
export function feedbackConfigured(): boolean {
  return FEEDBACK_ENDPOINT !== '' || WEB3FORMS_ACCESS_KEY !== '';
}

/** Collect the diagnostic context shown to the user before sending — no PII, all inspectable. */
export function collectContext(page: string, lang: string, level: string): FeedbackContext {
  return { page, lang, level, online: navigator.onLine };
}

/** Human-readable payload — a solo maintainer reads these by eye, so keep it flat and legible. */
function buildBody(input: FeedbackInput, ctx: FeedbackContext): FeedbackOutboxItem['body'] {
  return {
    subject: `Feedback: ${CATEGORY_LABEL[input.category]}`,
    category: CATEGORY_LABEL[input.category],
    message: input.text.trim() || '(no message)',
    email: input.email.trim(),
    app_version: __APP_VERSION__,
    page: ctx.page,
    ui_language: ctx.lang,
    level: ctx.level,
    user_agent: navigator.userAgent,
  };
}

async function deliver(body: FeedbackOutboxItem['body']): Promise<boolean> {
  try {
    if (FEEDBACK_ENDPOINT) {
      const res = await fetch(FEEDBACK_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.ok;
    }
    if (WEB3FORMS_ACCESS_KEY) {
      const res = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ access_key: WEB3FORMS_ACCESS_KEY, ...body }),
      });
      return res.ok;
    }
    return false; // nothing configured — keep it queued
  } catch {
    return false; // offline or endpoint down — keep it queued
  }
}

export async function submitFeedback(
  input: FeedbackInput,
  ctx: FeedbackContext
): Promise<SubmitResult> {
  const body = buildBody(input, ctx);
  if (await deliver(body)) return 'sent';
  try {
    await db.feedbackOutbox.add({ body, createdAt: Date.now() });
  } catch {
    // if even the outbox is unavailable there's nothing more we can do here
  }
  return 'queued';
}

let flushing = false;

/** Retry queued feedback. Runs on `online` and on app launch — Background Sync is iOS-unsupported. */
export async function flushFeedback(): Promise<void> {
  if (flushing || !navigator.onLine || !feedbackConfigured()) return;
  flushing = true;
  try {
    const queued = await db.feedbackOutbox.orderBy('createdAt').toArray();
    for (const item of queued) {
      if (!(await deliver(item.body))) break; // stop on first failure; retry later
      if (item.id != null) await db.feedbackOutbox.delete(item.id);
    }
  } catch {
    // best-effort
  } finally {
    flushing = false;
  }
}

export async function pendingFeedbackCount(): Promise<number> {
  try {
    return await db.feedbackOutbox.count();
  } catch {
    return 0;
  }
}

export function initFeedback(): void {
  window.addEventListener('online', () => void flushFeedback());
  void flushFeedback();
}
