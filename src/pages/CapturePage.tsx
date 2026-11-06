import { useCallback, useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Capacitor } from '@capacitor/core';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { vocabularyEntryPath } from '@/features/vocab/navigation';
import { useCaptureDraft } from '@/features/capture/draft';
import {
  androidCaptureIntent,
  captureDraftError,
  captureKey,
  captureLink,
  parseCaptureLink,
} from '@/features/capture/links';
import type { CapturePayload } from '@/features/capture/links';
import {
  CaptureConflict,
  readCapturedPhrase,
  saveCapturedPhrase,
} from '@/features/capture/service';
import type {
  CaptureAction,
  CaptureSnapshot,
} from '@/features/capture/service';
import '@/features/capture/capture.css';

const empty: CapturePayload = {
  term: '',
  translation: '',
  context: '',
  source: null,
};
export function CapturePage() {
  const location = useLocation();
  const parsed = parseCaptureLink(
    'https://dayenglish.ru' + location.pathname + location.search
  );
  return (
    <CaptureContent
      key={location.key}
      initial={parsed.ok ? parsed.value : empty}
      linkError={parsed.ok ? null : parsed.error}
    />
  );
}

function CaptureContent({
  initial,
  linkError,
}: {
  initial: CapturePayload;
  linkError: string | null;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial),
    [repeat, setRepeat] = useState(true);
  const [snapshot, setSnapshot] = useState<CaptureSnapshot | null>(null);
  const [loading, setLoading] = useState(true),
    [loadError, setLoadError] = useState(false);
  const [revision, setRevision] = useState(0),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(''),
    [invalid, setInvalid] = useState<string | null>(null);
  const [finished, setFinished] = useState<CaptureSnapshot | null>(null);
  const [view, setView] = useState<'capture' | 'cancelled' | 'preview'>(
    'capture'
  );
  const [revealed, setRevealed] = useState(false);
  const [confirm, setConfirm] = useState<CaptureAction | 'transfer' | null>(
    null
  );
  const [copyState, setCopyState] = useState<
    'idle' | 'copied' | 'manual' | 'invalid'
  >('idle');
  const epoch = useRef(0),
    lock = useRef(false),
    heading = useRef<HTMLHeadingElement>(null);
  const invalidate = useCallback(() => {
    epoch.current++;
    lock.current = false;
  }, []);
  const dirty =
    !finished &&
    view === 'capture' &&
    (draft.term !== initial.term ||
      draft.translation !== initial.translation ||
      draft.context !== initial.context ||
      !repeat);
  useCaptureDraft(dirty);
  useEffect(() => {
    if (!dirty) return;
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', leave);
    return () => window.removeEventListener('beforeunload', leave);
  }, [dirty]);
  useEffect(
    () =>
      subscribeDataScope(() => {
        invalidate();
        setDraft(initial);
        setRepeat(true);
        setBusy(false);
        setFinished(null);
        setSnapshot(null);
        setError('');
        setConfirm(null);
        setView('capture');
        setInvalid(null);
        setCopyState('idle');
        setRevision((n) => n + 1);
      }),
    [initial, invalidate]
  );
  useEffect(() => {
    const id = ++epoch.current,
      current = captureDataScope();
    setLoading(true);
    setLoadError(false);
    setSnapshot(null);
    const subscription = liveQuery(() =>
      readCapturedPhrase(draft.term, current)
    ).subscribe({
      next: (result) => {
        if (epoch.current === id && current()) {
          setSnapshot(result);
          setLoading(false);
        }
      },
      error: () => {
        if (epoch.current === id && current()) {
          setLoading(false);
          setLoadError(true);
        }
      },
    });
    return () => {
      subscription.unsubscribe();
      invalidate();
    };
  }, [draft.term, revision, invalidate]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, [finished, view]);
  const change = (field: 'term' | 'translation' | 'context', value: string) => {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setInvalid(null);
    setError('');
  };
  const ready =
    !loading &&
    !loadError &&
    snapshot &&
    captureKey(snapshot.key) === captureKey(draft.term);
  const existing = ready && snapshot.state !== 'new' ? snapshot : null;
  const run = async (action: CaptureAction) => {
    if (!ready || lock.current) return;
    const field =
      action === 'save'
        ? captureDraftError(draft)
        : action === 'edit' &&
            (!draft.translation.trim() || draft.translation.length > 500)
          ? 'translation'
          : null;
    if (field) {
      setInvalid(field);
      setError(
        field === 'term'
          ? t(
              'Введите английскую фразу до 240 символов.',
              'Enter an English phrase of up to 240 characters.'
            )
          : field === 'translation'
            ? t(
                'Введите перевод до 500 символов.',
                'Enter a translation of up to 500 characters.'
              )
            : t(
                'Сократите пример до 1000 символов или уберите его.',
                'Shorten the example to 1000 characters or remove it.'
              )
      );
      requestAnimationFrame(() => {
        const input = document.getElementById('capture-' + field);
        const details = input?.closest('details');
        if (details) details.open = true;
        input?.focus();
      });
      return;
    }
    lock.current = true;
    setBusy(true);
    setError('');
    setConfirm(null);
    const id = epoch.current,
      scope = captureDataScope(),
      active = () => id === epoch.current && scope();
    try {
      const result = await saveCapturedPhrase(
        draft,
        snapshot,
        action,
        repeat,
        active
      );
      if (!active()) return;
      if (!result.changed) {
        setSnapshot(result.snapshot);
        setError(
          t(
            'Фраза уже сохранена. Ваш перевод остался прежним.',
            'The phrase already exists. Your translation was preserved.'
          )
        );
      } else setFinished(result.snapshot);
    } catch (reason) {
      if (active())
        setError(
          reason instanceof CaptureConflict
            ? t(
                'Карточка изменилась. Проверьте актуальный вариант и повторите действие.',
                'The card changed. Check the current version and try again.'
              )
            : t(
                'Не удалось подтвердить сохранение. Текст на месте. Проверьте результат перед повтором.',
                'Could not confirm the save. Your text is intact. Check the result before retrying.'
              )
        );
    } finally {
      if (active()) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  const outgoing: CapturePayload = finished
    ? {
        term: finished.card?.front ?? draft.term,
        translation: finished.translation,
        context: finished.card?.contextSentence ?? draft.context,
        source: draft.source,
      }
    : draft;
  const transferLink = captureLink(outgoing);
  const transferable =
    captureDraftError(outgoing) === null && transferLink.length <= 8000;
  const copy = async () => {
    if (!transferable) {
      setCopyState('invalid');
      return;
    }
    try {
      await navigator.clipboard.writeText(transferLink);
      setCopyState('copied');
    } catch {
      setCopyState('manual');
    }
  };
  const invalidProps = (field: string) => ({
    'aria-invalid': invalid === field || undefined,
    'aria-describedby': invalid === field ? 'capture-error' : undefined,
  });
  const translationField = (
    <label className="capture-field" htmlFor="capture-translation">
      {t(
        existing ? 'Новый перевод' : 'Перевод для вашей карточки',
        existing ? 'New translation' : 'Translation for your card'
      )}
      <textarea
        id="capture-translation"
        rows={2}
        value={draft.translation}
        onChange={(event) => change('translation', event.target.value)}
        {...invalidProps('translation')}
      />
    </label>
  );
  const entry = finished ?? existing;
  const goVocabulary = (key?: string) =>
    void navigate(key ? vocabularyEntryPath(key) : '/vocabulary', {
      state: { fromCapture: true },
    });
  return (
    <div className="capture-layout">
      <section className="capture-intro">
        <p className="capture-eyebrow">
          {t('Фраза по ссылке', 'Phrase from a link')}
          {draft.source && ' · ' + (draft.source === 'vk' ? 'VK' : 'Telegram')}
        </p>
        <h1 ref={heading} tabIndex={-1}>
          {t('Из ленты — в речь.', 'From your feed to your vocabulary.')}
        </h1>
        <p>
          {t(
            'Сохраните полезное выражение. DayEnglish поможет вернуться к нему в повторении.',
            'Save a useful expression and revisit it with DayEnglish.'
          )}
        </p>
        <p className="capture-journey">
          {t('Проверить → Сохранить → Вспомнить', 'Check → Save → Remember')}
        </p>
        {draft.context && (
          <blockquote className="capture-source" lang="en">
            {draft.context}
          </blockquote>
        )}
      </section>
      <section
        className="capture-panel"
        aria-label={t('Сохранение фразы', 'Phrase capture')}
      >
        <div className="capture-title">
          <h2>
            {t(
              finished ? 'Готово' : 'Сохранить фразу',
              finished ? 'Done' : 'Save a phrase'
            )}
          </h2>
          <span>{t('Бесплатно', 'Free')}</span>
        </div>
        {view === 'cancelled' ? (
          <>
            <h3>{t('Ничего не добавлено', 'Nothing added')}</h3>
            <p>
              {t(
                'Можно вернуться к фразе или продолжить знакомство с DayEnglish.',
                'Return to the phrase or explore DayEnglish.'
              )}
            </p>
            <div className="capture-actions">
              <Button onClick={() => setView('capture')}>
                {t('Вернуться к фразе', 'Return to phrase')}
              </Button>
              <Link to="/">
                {t('Открыть DayEnglish', 'Explore DayEnglish')}
              </Link>
            </div>
          </>
        ) : finished ? (
          <>
            <p className="capture-notice" role="status">
              {t('Фраза в вашем словаре', 'The phrase is in your vocabulary')}
            </p>
            <h3 className="capture-term" lang="en">
              {finished.card?.front ?? draft.term}
            </h3>
            {view !== 'preview' || revealed ? (
              <p>{finished.translation}</p>
            ) : (
              <Button onClick={() => setRevealed(true)}>
                {t('Показать перевод', 'Show translation')}
              </Button>
            )}
            <p className="capture-muted">
              {t(
                finished.card && finished.status?.status !== 'ignored'
                  ? 'Карточка участвует в повторении.'
                  : 'Сохранено без активного повторения.',
                finished.card && finished.status?.status !== 'ignored'
                  ? 'The card is included in review.'
                  : 'Saved without active review.'
              )}
            </p>
            <div className="capture-actions">
              {view !== 'preview' && (
                <Button
                  onClick={() => {
                    setRevealed(false);
                    setView('preview');
                  }}
                >
                  {t('Посмотреть карточку', 'Preview card')}
                </Button>
              )}
              <Button
                variant="ghost"
                onClick={() => goVocabulary(finished.key)}
              >
                {t('Открыть в словаре', 'Open in vocabulary')}
              </Button>
              <Link to="/">{t('Перейти к занятиям', 'Continue learning')}</Link>
            </div>
            {view === 'preview' && (
              <p className="capture-muted">
                {t(
                  'Это предпросмотр. История и расписание не меняются.',
                  'This is a preview. Your history and schedule stay unchanged.'
                )}
              </p>
            )}
            {!Capacitor.isNativePlatform() && (
              <details className="capture-transfer">
                <summary>
                  {t('Продолжить в приложении', 'Continue in the app')}
                </summary>
                <p>
                  {t(
                    'Фраза сохранена в этом браузере. Для приложения откройте ссылку и подтвердите сохранение там.',
                    'The phrase is saved in this browser. Open the link and confirm the save in the app.'
                  )}
                </p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setCopyState('idle');
                    setConfirm('transfer');
                  }}
                >
                  {t('Открыть или установить', 'Open or install')}
                </Button>
              </details>
            )}
          </>
        ) : (
          <>
            {linkError && (
              <p className="capture-notice">
                {t(
                  linkError === 'version'
                    ? 'Эта версия ссылки пока не поддерживается. Можно ввести фразу вручную.'
                    : 'Не удалось прочитать фразу из ссылки. Введите её ниже.',
                  linkError === 'version'
                    ? 'This link version is not supported. You can enter the phrase manually.'
                    : 'Could not read the phrase link. Enter it below.'
                )}
              </p>
            )}
            {loadError && (
              <div className="capture-notice" role="alert">
                <p>
                  {t(
                    'Не удалось открыть словарь. Сохранение пока недоступно; введённый текст на месте.',
                    'Could not open your vocabulary. Saving is unavailable; your text is intact.'
                  )}
                </p>
                <Button onClick={() => setRevision((n) => n + 1)}>
                  {t('Повторить', 'Retry')}
                </Button>
              </div>
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (!existing) void run('save');
              }}
            >
              <fieldset disabled={busy} className="capture-fields">
                {existing ? (
                  <>
                    <div className="capture-notice">
                      <h3>
                        {t(
                          existing.state === 'deleted'
                            ? 'Раньше вы удалили эту карточку'
                            : existing.status?.status === 'ignored'
                              ? 'Эта фраза отмечена «Игнор»'
                              : existing.status?.status === 'known'
                                ? 'Вы уже знаете эту фразу'
                                : 'Уже в вашем словаре',
                          existing.state === 'deleted'
                            ? 'You removed this card before'
                            : existing.status?.status === 'ignored'
                              ? 'This phrase is ignored'
                              : existing.status?.status === 'known'
                                ? 'You already know this phrase'
                                : 'Already in your vocabulary'
                        )}
                      </h3>
                      <p className="capture-term" lang="en">
                        {existing.card?.front ?? draft.term}
                      </p>
                      <p>
                        {existing.translation ||
                          t('Без перевода', 'No translation')}
                      </p>
                      <p className="capture-muted">
                        {t(
                          'Ваш перевод, история и срок повторения сохраняются.',
                          'Your translation, history and review date are preserved.'
                        )}
                      </p>
                      {existing.state === 'deleted' ? (
                        <Button onClick={() => void run('restore')}>
                          {t(
                            'Восстановить прежнюю карточку',
                            'Restore original card'
                          )}
                        </Button>
                      ) : (
                        <Button onClick={() => goVocabulary(existing.key)}>
                          {t('Открыть мою карточку', 'Open my entry')}
                        </Button>
                      )}
                    </div>
                    {existing.state !== 'deleted' && (
                      <details className="capture-extra">
                        <summary>
                          {t('Другие действия', 'Other actions')}
                        </summary>
                        {translationField}
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (
                              !draft.translation.trim() ||
                              draft.translation.length > 500
                            ) {
                              setInvalid('translation');
                              setError(
                                t(
                                  'Введите перевод до 500 символов.',
                                  'Enter a translation of up to 500 characters.'
                                )
                              );
                            } else setConfirm('edit');
                          }}
                        >
                          {t('Изменить мой перевод', 'Update my translation')}
                        </Button>
                        {!existing.card &&
                          existing.status?.status !== 'ignored' && (
                            <Button
                              variant="ghost"
                              onClick={() => setConfirm('review')}
                            >
                              {t('Добавить в повторение', 'Add to review')}
                            </Button>
                          )}
                        {(existing.status?.status === 'known' ||
                          existing.status?.status === 'ignored') && (
                          <Button
                            variant="ghost"
                            onClick={() => setConfirm('learning')}
                          >
                            {t('Вернуть к изучению', 'Return to learning')}
                          </Button>
                        )}
                      </details>
                    )}
                  </>
                ) : (
                  <>
                    <label className="capture-field" htmlFor="capture-term">
                      {t('Английская фраза', 'English phrase')}
                      <textarea
                        id="capture-term"
                        lang="en"
                        rows={2}
                        value={draft.term}
                        spellCheck={false}
                        onChange={(event) => change('term', event.target.value)}
                        {...invalidProps('term')}
                      />
                    </label>
                    {translationField}
                    <details className="capture-example">
                      <summary>
                        {t('Пример из ссылки', 'Example from the link')}
                      </summary>
                      <label
                        className="capture-field"
                        htmlFor="capture-context"
                      >
                        {t('Пример (необязательно)', 'Example (optional)')}
                        <textarea
                          id="capture-context"
                          lang="en"
                          rows={3}
                          value={draft.context}
                          onChange={(event) =>
                            change('context', event.target.value)
                          }
                          {...invalidProps('context')}
                        />
                      </label>
                      {draft.context && (
                        <Button
                          variant="ghost"
                          onClick={() => change('context', '')}
                        >
                          {t('Убрать пример', 'Remove example')}
                        </Button>
                      )}
                    </details>
                    <label className="capture-check">
                      <input
                        type="checkbox"
                        checked={repeat}
                        onChange={(event) => setRepeat(event.target.checked)}
                      />
                      <span>
                        {t('Добавить в повторение', 'Include in review')}
                        <small>
                          {t(
                            'Можно сохранить только в словарь.',
                            'You can save to vocabulary only.'
                          )}
                        </small>
                      </span>
                    </label>
                    <Button type="submit" disabled={!ready}>
                      {busy
                        ? t('Сохраняем…', 'Saving…')
                        : repeat
                          ? t('Сохранить и повторять', 'Save and review')
                          : t('Сохранить в словарь', 'Save to vocabulary')}
                    </Button>
                  </>
                )}
                <Button variant="ghost" onClick={() => setView('cancelled')}>
                  {t('Не сейчас', 'Not now')}
                </Button>
              </fieldset>
            </form>
            {loading && (
              <p role="status" className="capture-muted">
                {t('Проверяем словарь…', 'Checking your vocabulary…')}
              </p>
            )}
            {error && (
              <div id="capture-error" className="capture-error" role="alert">
                <p>{error}</p>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setInvalid(null);
                    setError('');
                    setRevision((n) => n + 1);
                  }}
                >
                  {t('Проверить результат', 'Check result')}
                </Button>
              </div>
            )}
            <p className="capture-muted">
              {t(
                'Без регистрации и подписки.',
                'No account or subscription required.'
              )}
            </p>
            {!Capacitor.isNativePlatform() && (
              <p className="capture-muted">
                {t('Сохранится в этом браузере.', 'Saved in this browser.')}{' '}
                <button
                  className="capture-text-link"
                  onClick={() => {
                    setCopyState('idle');
                    setConfirm('transfer');
                  }}
                >
                  {t('Открыть в приложении', 'Open in app')}
                </button>
              </p>
            )}
          </>
        )}
        {confirm && (
          <Dialog
            title={
              confirm === 'transfer'
                ? t('Продолжить в приложении', 'Continue in the app')
                : t('Подтвердите изменение', 'Confirm change')
            }
            onClose={() => {
              if (!busy) setConfirm(null);
            }}
          >
            {confirm === 'transfer' ? (
              <>
                <p>
                  {t(
                    'Откройте эту фразу в DayEnglish. Если приложения пока нет, можно установить его и вернуться по ссылке.',
                    'Open this phrase in DayEnglish. If needed, install the app and reopen the link.'
                  )}
                </p>
                <div className="capture-actions">
                  {/Android/i.test(navigator.userAgent) && transferable && (
                    <a
                      className="capture-app-link"
                      href={androidCaptureIntent(outgoing)}
                    >
                      {t('Открыть DayEnglish', 'Open DayEnglish')}
                    </a>
                  )}
                  <Button onClick={() => void copy()}>
                    {t(
                      'Скопировать ссылку с переводом',
                      'Copy link with translation'
                    )}
                  </Button>
                  <a
                    href="https://www.rustore.ru/catalog/app/ru.dayenglish.app"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t(
                      'Android-приложение в RuStore',
                      'Android app in RuStore'
                    )}
                  </a>
                </div>
                <p className="capture-muted">
                  {t(
                    'После установки откройте ссылку снова. Она переносит только эту фразу; сохранение нужно подтвердить.',
                    'Reopen the link after installing. It carries this phrase only; confirm the save in the app.'
                  )}
                </p>
                <p role="status">
                  {copyState === 'invalid'
                    ? t(
                        'Проверьте длину фразы, перевода и примера. Сейчас они не помещаются в ссылку.',
                        'Check the phrase, translation and example lengths. They do not currently fit in a link.'
                      )
                    : copyState === 'copied'
                      ? t('Ссылка скопирована.', 'Link copied.')
                      : copyState === 'manual'
                        ? t(
                            'Выделите и скопируйте ссылку ниже.',
                            'Select and copy the link below.'
                          )
                        : ''}
                </p>
                {copyState === 'manual' && (
                  <textarea
                    className="capture-copy"
                    readOnly
                    aria-label={t('Ссылка на фразу', 'Phrase link')}
                    value={transferLink}
                    onFocus={(event) => event.currentTarget.select()}
                  />
                )}
              </>
            ) : (
              <>
                <p>
                  {confirm === 'edit'
                    ? t('Новый перевод: ', 'New translation: ') +
                      draft.translation
                    : confirm === 'review'
                      ? t(
                          'Фраза появится в повторении. Ваша отметка «Знаю» сохранится.',
                          'The phrase will join review. Your Known status is preserved.'
                        )
                      : t(
                          'Изменится только отметка фразы. Существующая история и расписание останутся прежними.',
                          'Only the phrase status changes. Existing history and schedule are preserved.'
                        )}
                </p>
                <div className="capture-actions">
                  <Button onClick={() => void run(confirm)}>
                    {t('Подтвердить', 'Confirm')}
                  </Button>
                  <Button variant="ghost" onClick={() => setConfirm(null)}>
                    {t('Отмена', 'Cancel')}
                  </Button>
                </div>
              </>
            )}
          </Dialog>
        )}
        {entry?.status?.status === 'ignored' && finished && (
          <p className="capture-muted">
            {t(
              'Отметка «Игнор» сохранена.',
              'The Ignored status is preserved.'
            )}
          </p>
        )}
      </section>
    </div>
  );
}
