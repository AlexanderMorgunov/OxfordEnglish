import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { liveQuery } from 'dexie';
import { useLocation } from 'react-router-dom';
import type { FeedbackOutboxItem } from '@/db/db';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { AppIcon } from '@/shared/ui/AppIcon';
import { Dialog } from '@/shared/ui/Dialog';
import {
  collectContext,
  feedbackBody,
  feedbackIdentity,
  readPendingFeedback,
  retryFeedback,
  submitFeedback,
  subscribeFeedbackDelivery,
} from './service';
import type { FeedbackItem } from './service';
import {
  CATEGORIES,
  beginFeedbackAttempt,
  MIN_DETAIL,
  useFeedbackDraft,
  validateFeedback,
} from './draft';
import { FeedbackContext } from './FeedbackContext';
import { FeedbackReceipt } from './FeedbackReceipt';

type PendingItem = FeedbackOutboxItem & { id: number };
const asItem = (row: PendingItem): FeedbackItem => ({
  ...row,
  submissionId: feedbackIdentity(row),
});

export function FeedbackForm() {
  const lang = useUiLang((s) => s.lang),
    ru = lang === 'ru',
    t = (rus: string, en: string) => (ru ? rus : en);
  const level = useLearner((s) => s.level),
    page = useLocation().pathname;
  const { draft, receipt, edit, receive, reset } = useFeedbackDraft();
  const [busy, setBusy] = useState(false),
    [attempted, setAttempted] = useState(false),
    [clearOpen, setClearOpen] = useState(false);
  const [sendError, setSendError] = useState('');
  const [attemptBody, setAttemptBody] = useState<
    FeedbackOutboxItem['body'] | null
  >(null);
  const [pending, setPending] = useState<PendingItem[]>([]),
    [queueState, setQueueState] = useState<'loading' | 'ready' | 'error'>(
      'loading'
    ),
    [refresh, setRefresh] = useState(0);
  const root = useRef<HTMLElement>(null),
    summary = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null),
    errorBox = useRef<HTMLDivElement>(null);
  const controller = useRef<AbortController | null>(null),
    lock = useRef(false),
    mounted = useRef(false),
    focusResult = useRef(false);
  const errors = attempted ? validateFeedback(draft) : [];
  const activeCategory =
    CATEGORIES.find((c) => c.id === draft.category) ?? CATEGORIES[0]!;
  const context = collectContext(page, lang, level ?? 'not set');
  const body = feedbackBody(
    {
      category: draft.category ?? 'other',
      text: draft.text,
      email: draft.email,
    },
    context,
    draft.submissionId
  );
  const dirty = Boolean(draft.category || draft.text || draft.email);
  const errorText = {
    category: t('Выберите тему обращения.', 'Choose a topic.'),
    text: t(
      'Добавьте описание: минимум 10 символов без пробелов по краям.',
      'Add at least 10 characters of detail, excluding surrounding spaces.'
    ),
    email: t(
      'Проверьте адрес почты или оставьте поле пустым.',
      'Check your email address or leave it blank.'
    ),
  };
  const fieldId = (field: 'category' | 'text' | 'email') =>
    field === 'category' ? 'feedback-category-broken' : `feedback-${field}`;

  useEffect(() => {
    mounted.current = true;
    const leave = () => controller.current?.abort();
    const connection = () => setRefresh((n) => n + 1);
    window.addEventListener('pagehide', leave);
    window.addEventListener('online', connection);
    window.addEventListener('offline', connection);
    const scope = subscribeDataScope(() => {
      leave();
      setPending([]);
      setRefresh((n) => n + 1);
      setSendError('');
    });
    const delivered = subscribeFeedbackDelivery((id) => {
      const state = useFeedbackDraft.getState();
      if (state.receipt?.item.submissionId === id)
        state.receive({ status: 'sent', item: state.receipt.item });
    });
    return () => {
      mounted.current = false;
      leave();
      scope();
      delivered();
      window.removeEventListener('pagehide', leave);
      window.removeEventListener('online', connection);
      window.removeEventListener('offline', connection);
    };
  }, []);
  useEffect(() => {
    const current = captureDataScope();
    const subscription = liveQuery(readPendingFeedback).subscribe({
      next: (rows) => {
        if (current()) {
          setPending(rows);
          setQueueState('ready');
        }
      },
      error: () => {
        if (current()) setQueueState('error');
      },
    });
    return () => subscription.unsubscribe();
  }, [refresh]);
  useLayoutEffect(() => {
    if (busy || !focusResult.current) return;
    focusResult.current = false;
    if (document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    if (
      active !== document.body &&
      active instanceof Node &&
      !root.current?.contains(active)
    )
      return;
    (sendError ? errorBox.current : heading.current)?.focus();
  }, [busy, receipt, sendError]);

  async function run(source?: PendingItem) {
    if (lock.current) return;
    const current = captureDataScope(),
      snapshot = { ...draft };
    if (!source && (!snapshot.category || validateFeedback(snapshot).length))
      return;
    const latest = beginFeedbackAttempt();
    const snapshotContext = collectContext(page, lang, level ?? 'not set');
    setAttemptBody(
      source?.body ??
        feedbackBody(
          {
            category: snapshot.category!,
            text: snapshot.text,
            email: snapshot.email,
          },
          snapshotContext,
          snapshot.submissionId
        )
    );
    lock.current = true;
    setBusy(true);
    setSendError('');
    const attempt = new AbortController();
    controller.current = attempt;
    try {
      const result = source
        ? await retryFeedback(source, { signal: attempt.signal, current })
        : await submitFeedback(
            {
              category: snapshot.category!,
              text: snapshot.text,
              email: snapshot.email,
            },
            snapshotContext,
            {
              signal: attempt.signal,
              current,
              submissionId: snapshot.submissionId,
            }
          );
      if (!current() || !latest()) return;
      receive(result);
      if (mounted.current) focusResult.current = true;
    } catch {
      if (!current() || !latest() || !mounted.current) return;
      setSendError(
        source
          ? t(
              'Не удалось повторить отправку. Проверьте список сохранённых сообщений и попробуйте снова. Текст ниже можно скопировать.',
              'Delivery could not be retried. Check saved messages and try again. You can copy the text below.'
            )
          : attempt.signal.aborted
            ? t(
                'Попытка прервана до сохранения. Черновик остался в форме.',
                'The attempt stopped before saving. Your draft is still in the form.'
              )
            : t(
                'Не удалось сохранить сообщение на устройстве. Оно не отправлено. Текст остался в форме — скопируйте его или попробуйте снова.',
                'The message could not be saved on this device. It was not sent. Your text is still in the form: copy it or try again.'
              )
      );
      focusResult.current = true;
    } finally {
      lock.current = false;
      if (controller.current === attempt) controller.current = null;
      if (mounted.current) {
        setBusy(false);
        setRefresh((n) => n + 1);
      }
    }
  }
  function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current) return;
    setAttempted(true);
    if (validateFeedback(draft).length) {
      requestAnimationFrame(() => summary.current?.focus());
      return;
    }
    void run();
  }
  function newMessage() {
    if (lock.current) return;
    if (receipt && receipt.item.submissionId !== draft.submissionId && dirty)
      receive(null);
    else reset();
    setAttempted(false);
    setSendError('');
    focusResult.current = true;
  }
  const saved = pending.filter(
    (item) =>
      feedbackIdentity(item) !== receipt?.item.submissionId &&
      (!busy || feedbackIdentity(item) !== draft.submissionId)
  );
  return (
    <section
      ref={root}
      className="fb-feedback-panel"
      aria-label={t('Ваше сообщение', 'Your message')}
    >
      {receipt ? (
        <FeedbackReceipt
          result={receipt}
          busy={busy}
          heading={heading}
          onRetry={() => void run(receipt.item)}
          onNew={newMessage}
          hasDraft={receipt.item.submissionId !== draft.submissionId && dirty}
        />
      ) : (
        <>
          <h2 ref={heading} tabIndex={-1}>
            {t('Что хотите рассказать?', 'What would you like to tell us?')}
          </h2>
          <p className="fb-form-lede">
            {t(
              'Выберите тему и добавьте пару предложений.',
              'Choose a topic and add a couple of sentences.'
            )}
          </p>
          <form noValidate onSubmit={send} aria-busy={busy}>
            {errors.length > 0 && (
              <div
                className="fb-error-summary"
                ref={summary}
                tabIndex={-1}
                role="alert"
              >
                <h3>{t('Проверьте сообщение', 'Check your message')}</h3>
                <ul>
                  {errors.map((field) => (
                    <li key={field}>
                      <a
                        href={`#${fieldId(field)}`}
                        onClick={(event) => {
                          event.preventDefault();
                          document.getElementById(fieldId(field))?.focus();
                        }}
                      >
                        {errorText[field]}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <fieldset disabled={busy} className="fb-editable-fields">
              <legend className="sr-only">
                {t('Содержание сообщения', 'Message contents')}
              </legend>
              <fieldset
                className="fb-category-group"
                aria-invalid={errors.includes('category') || undefined}
                aria-describedby={
                  errors.includes('category')
                    ? 'feedback-category-error'
                    : undefined
                }
              >
                <legend>
                  {t('Тема обращения', 'Topic')}{' '}
                  <span className="fb-required">
                    {t('Обязательно', 'Required')}
                  </span>
                </legend>
                <div className="fb-category-options">
                  {CATEGORIES.map((c) => (
                    <label className="fb-category-option" key={c.id}>
                      <input
                        type="radio"
                        name="category"
                        value={c.id}
                        id={`feedback-category-${c.id}`}
                        required
                        checked={draft.category === c.id}
                        onChange={() => edit({ category: c.id })}
                      />
                      <AppIcon name={c.icon} className="fb-category-icon" />
                      <span>{ru ? c.ru : c.en}</span>
                    </label>
                  ))}
                </div>
                {errors.includes('category') && (
                  <p className="fb-field-error" id="feedback-category-error">
                    {errorText.category}
                  </p>
                )}
              </fieldset>
              <div className="fb-field">
                <label htmlFor="feedback-text">
                  {t('Расскажите подробнее', 'Tell us more')}{' '}
                  <span className="fb-required">
                    {t('Обязательно', 'Required')}
                  </span>
                </label>
                <p className="fb-field-hint" id="feedback-detail-hint">
                  {activeCategory.hint[ru ? 0 : 1]}
                </p>
                <textarea
                  id="feedback-text"
                  name="message"
                  required
                  minLength={MIN_DETAIL}
                  rows={5}
                  value={draft.text}
                  onChange={(event) => edit({ text: event.target.value })}
                  aria-invalid={errors.includes('text') || undefined}
                  aria-describedby={`feedback-detail-hint feedback-detail-min${errors.includes('text') ? ' feedback-text-error' : ''}`}
                  placeholder={activeCategory.placeholder[ru ? 0 : 1]}
                />
                <div className="fb-detail-meta">
                  <span id="feedback-detail-min">
                    {t('Минимум 10 символов', 'At least 10 characters')}
                  </span>
                  <span aria-hidden="true">{draft.text.trim().length}</span>
                </div>
                {errors.includes('text') && (
                  <p className="fb-field-error" id="feedback-text-error">
                    {errorText.text}
                  </p>
                )}
              </div>
              <div className="fb-field">
                <label htmlFor="feedback-email">
                  {t('Почта для ответа', 'Reply email')}{' '}
                  <span className="fb-optional">
                    {t('Необязательно', 'Optional')}
                  </span>
                </label>
                <input
                  id="feedback-email"
                  name="email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={draft.email}
                  onChange={(event) => edit({ email: event.target.value })}
                  aria-invalid={errors.includes('email') || undefined}
                  aria-describedby={`feedback-email-hint${errors.includes('email') ? ' feedback-email-error' : ''}`}
                />
                <p className="fb-field-hint" id="feedback-email-hint">
                  {t(
                    'Оставьте, если можно написать вам для уточнения. Без почты сообщение тоже отправится.',
                    'Leave an email if we can contact you for details. Your message can be sent without one.'
                  )}
                </p>
                {errors.includes('email') && (
                  <p className="fb-field-error" id="feedback-email-error">
                    {errorText.email}
                  </p>
                )}
              </div>
            </fieldset>
            <FeedbackContext body={busy && attemptBody ? attemptBody : body} />
            <div className="fb-submit-row">
              <button
                type="submit"
                className="fb-btn fb-primary"
                disabled={busy}
              >
                {busy
                  ? t('Отправляем…', 'Sending…')
                  : t('Отправить сообщение', 'Send message')}
                <span aria-hidden="true">→</span>
              </button>
              <button
                type="button"
                className="fb-text-button fb-clear-draft"
                disabled={busy || !dirty}
                onClick={() => setClearOpen(true)}
              >
                {t('Очистить', 'Clear')}
              </button>
            </div>
          </form>
        </>
      )}
      {busy && (
        <div className="fb-operation-status">
          <p role="status">
            {t(
              'Проверяем доставку. Повторно нажимать не нужно.',
              'Checking delivery. There is no need to send again.'
            )}
          </p>
          <button
            type="button"
            className="fb-text-button"
            onClick={() => controller.current?.abort()}
          >
            {t('Прервать попытку', 'Stop attempt')}
          </button>
          <p>
            {t(
              'Прерывание не отзывает уже принятое сервисом сообщение. Сохранённая запись останется в очереди.',
              'Stopping cannot recall a message already accepted by the service. A saved record stays in the queue.'
            )}
          </p>
        </div>
      )}
      {sendError && (
        <div
          className="fb-send-error"
          ref={errorBox}
          tabIndex={-1}
          role="alert"
        >
          {sendError}
        </div>
      )}
      <div className="fb-queue-status" aria-live="polite">
        <p className="sr-only" role="status">
          {receipt && !busy
            ? receipt.status === 'sent'
              ? t('Сообщение отправлено.', 'Message sent.')
              : t(
                  'Сообщение сохранено и ожидает отправки.',
                  'Message saved and awaiting delivery.'
                )
            : ''}
        </p>
        {queueState === 'loading' && (
          <p>
            {t('Проверяем сохранённые сообщения…', 'Checking saved messages…')}
          </p>
        )}
        {queueState === 'error' && (
          <p>
            {t(
              'Не удалось прочитать очередь на устройстве.',
              'Saved messages could not be read.'
            )}{' '}
            <button
              type="button"
              className="fb-text-button"
              onClick={() => {
                setQueueState('loading');
                setRefresh((n) => n + 1);
              }}
            >
              {t('Проверить ещё раз', 'Check again')}
            </button>
          </p>
        )}
      </div>
      {saved.length > 0 && (
        <section
          className="fb-saved-messages"
          aria-label={t('Сохранённые сообщения', 'Saved messages')}
        >
          <h3>
            {t('Ожидают отправки', 'Awaiting delivery')} · {saved.length}
          </h3>
          <ul>
            {saved.map((item) => (
              <li key={item.id}>
                <p>{String(item.body.message ?? '')}</p>
                <button
                  type="button"
                  className="fb-text-button"
                  disabled={busy}
                  onClick={() => {
                    receive({ status: 'queued', item: asItem(item) });
                    setSendError('');
                    focusResult.current = true;
                  }}
                >
                  {t('Посмотреть сообщение', 'View message')}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {clearOpen && (
        <Dialog
          title={t('Очистить черновик?', 'Clear your draft?')}
          onClose={() => setClearOpen(false)}
          footer={
            <>
              <button
                type="button"
                className="fb-btn"
                onClick={() => setClearOpen(false)}
              >
                {t('Оставить черновик', 'Keep draft')}
              </button>
              <button
                type="button"
                className="fb-btn fb-primary"
                onClick={() => {
                  setClearOpen(false);
                  newMessage();
                }}
              >
                {t('Очистить', 'Clear')}
              </button>
            </>
          }
        >
          <p>
            {t(
              'Текст сообщения, тема и почта будут удалены из этой формы.',
              'Your message, topic and email will be removed from this form.'
            )}
          </p>
        </Dialog>
      )}
    </section>
  );
}
