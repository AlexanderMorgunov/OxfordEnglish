import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { liveQuery } from 'dexie';
import type { SrsCard } from '@/db/db';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { captureDataScope } from '@/features/account/dataScope';
import { readerReturnPath } from '@/features/reader/return-to-reader';
import { track } from '@/features/analytics/analytics';
import { ReviewCard } from './ReviewCard';
import { reviewCorrectionCard } from './service';
import type { ReviewReceipt } from './service';
import { useReviewData, removeLegacyCards } from './review-data';
import {
  sessionCards,
  startReviewSession,
  updateReviewSession,
  useReviewSession,
} from './review-session';
import { ReviewOverview } from './ReviewOverview';
import { ReviewIcon } from './ReviewIcon';
import { queueAndroidInstall } from '@/features/android-install/memory';

const RATING_LABELS = {
  ru: ['Снова', 'Трудно', 'Хорошо', 'Легко'],
  en: ['Again', 'Hard', 'Good', 'Easy'],
};

export function ReviewScreen() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    location = useLocation(),
    navigate = useNavigate();
  const resource = useReviewData(),
    session = useReviewSession((s) => s.session);
  const [correction, setCorrection] = useState<{
    receipt: ReviewReceipt;
    card: SrsCard;
    returnPath: string;
  } | null>(null);
  const [opening, setOpening] = useState(false),
    [cardBusy, setCardBusy] = useState(false),
    [error, setError] = useState('');
  const [removing, setRemoving] = useState<string[] | null>(null),
    [removalBusy, setRemovalBusy] = useState(false);
  const operation = useRef(false),
    busyRef = useRef(false),
    alive = useRef(false),
    cardRegion = useRef<HTMLDivElement>(null),
    heading = useRef<HTMLHeadingElement>(null);
  const focusPending = useRef(false);
  const focusedPath = useRef(location.pathname);
  const focusedCard = useRef<string | null>(null);
  const changeBusy = useCallback((busy: boolean) => {
    busyRef.current = busy;
    setCardBusy(busy);
  }, []);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const ready = resource.status === 'ready',
    data = resource.data;
  const path = (to: string) =>
    to +
    (new URLSearchParams(location.search).get('from') === 'reader'
      ? '?from=reader'
      : '');
  const available = session && data ? sessionCards(session, data.due) : [];
  const remaining = available.filter(
    (card) => !session?.skipped.includes(card.id)
  );
  const skipped = available.filter((card) =>
    session?.skipped.includes(card.id)
  );
  const sessionView =
    location.pathname === '/review/session' && Boolean(session);
  const summary =
    location.pathname === '/review/summary' &&
    Boolean(session) &&
    remaining.length === 0;
  const card = correction?.card ?? remaining[0],
    last = session?.receipts.at(-1) ?? null;
  const reviewed = session?.receipts.length ?? 0;
  const unavailable = session
    ? Math.max(
        0,
        session.members.length -
          reviewed -
          available.length -
          session.removed.length
      )
    : 0;
  const [correctionError, setCorrectionError] = useState(false);
  useEffect(() => {
    if (!ready || !session) return;
    if (sessionView && !card && !cardBusy && !opening)
      navigate(path('/review/summary'), { replace: true });
    if (remaining.length === 0 && reviewed > 0 && !session.tracked) {
      updateReviewSession((previous) => ({ ...previous, tracked: true }));
      queueAndroidInstall();
      void track('review_session_completed');
    }
  });
  useLayoutEffect(() => {
    if (focusedPath.current !== location.pathname) {
      focusedPath.current = location.pathname;
      focusPending.current = true;
    }
    if (ready && sessionView && card && focusedCard.current !== card.id) {
      focusedCard.current = card.id;
      focusPending.current = true;
    }
    if (!ready || !focusPending.current) return;
    focusPending.current = false;
    if (
      document.querySelector('dialog[open]') ||
      document.activeElement?.closest('header.app-header')
    )
      return;
    const target = sessionView && card ? cardRegion.current : heading.current;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  });
  const correcting = correction?.receipt;
  useEffect(() => {
    if (!correcting || cardBusy) return;
    const current = captureDataScope();
    const query = liveQuery(() => reviewCorrectionCard(correcting)).subscribe({
      next: (row) => {
        if (!alive.current || !current() || busyRef.current) return;
        if (row) {
          setCorrection((previous) =>
            previous?.receipt === correcting
              ? { ...previous, card: row }
              : previous
          );
          setCorrectionError(false);
        } else {
          setCorrection(null);
          setError(
            ru
              ? 'Предыдущая карточка изменилась. Оценку изменить нельзя.'
              : 'The previous card changed. Its rating cannot be changed.'
          );
        }
      },
      error: () => {
        if (alive.current && current()) {
          setCorrectionError(true);
          setError(
            ru
              ? 'Не удалось проверить предыдущую карточку. Вернитесь без изменения и повторите.'
              : 'Could not check the previous card. Continue without changes and retry.'
          );
        }
      },
    });
    return () => query.unsubscribe();
  }, [correcting, cardBusy, ru]);
  const start = () => {
    if (!ready || !data) return;
    if (!session || available.length === 0) startReviewSession(data.due);
    else if (remaining.length === 0)
      updateReviewSession((previous) => ({
        ...previous,
        skipped: [],
        revealed: [],
      }));
    setError('');
    focusPending.current = true;
    navigate(path('/review/session'));
  };
  const openCorrection = async () => {
    if (!last || operation.current || busyRef.current || !ready) return;
    const current = captureDataScope();
    operation.current = true;
    setOpening(true);
    setError('');
    try {
      const row = await reviewCorrectionCard(last);
      if (!alive.current || !current()) return;
      if (row) {
        setCorrection({
          receipt: last,
          card: row,
          returnPath: location.pathname,
        });
        setCorrectionError(false);
        focusPending.current = true;
        navigate(path('/review/session'));
      } else
        setError(
          ru
            ? 'Предыдущая карточка изменилась. Оценку изменить нельзя.'
            : 'The previous card changed. Its rating cannot be changed.'
        );
    } catch {
      if (alive.current && current())
        setError(
          ru
            ? 'Не удалось открыть карточку. Попробуйте ещё раз.'
            : 'Could not open the card. Please try again.'
        );
    } finally {
      if (alive.current && current()) {
        operation.current = false;
        setOpening(false);
      }
    }
  };
  const cancelCorrection = () => {
    const to = correction?.returnPath ?? '/review/session';
    setCorrection(null);
    setCorrectionError(false);
    setError('');
    focusPending.current = true;
    navigate(path(to));
  };
  const graded = (receipt: ReviewReceipt) => {
    if (
      !receipt.currentScope() ||
      useReviewSession.getState().session?.id !== session?.id
    )
      return;
    const correctingNow = Boolean(correction),
      to = correction?.returnPath;
    updateReviewSession((previous) => ({
      ...previous,
      receipts: correctingNow
        ? previous.receipts.map((item) =>
            item.review.id === receipt.review.id ? receipt : item
          )
        : [...previous.receipts, receipt],
    }));
    if (!alive.current) return;
    setCorrection(null);
    setError('');
    focusPending.current = true;
    if (to) navigate(path(to));
  };
  const remove = async () => {
    if (!removing || operation.current) return;
    operation.current = true;
    setRemovalBusy(true);
    setError('');
    const current = captureDataScope(),
      ids = removing;
    try {
      const removed = await removeLegacyCards(ids, current);
      if (!alive.current || !current()) return;
      updateReviewSession((previous) => ({
        ...previous,
        removed: [
          ...new Set([
            ...previous.removed,
            ...removed.filter((id) =>
              previous.members.some((item) => item.id === id)
            ),
          ]),
        ],
      }));
      setRemoving(null);
      focusPending.current = true;
    } catch {
      if (alive.current && current())
        setError(
          ru
            ? 'Не удалось убрать карточки. Изменения не сохранены. Повторите попытку.'
            : 'Could not remove cards. Changes were not saved. Please retry.'
        );
    } finally {
      if (alive.current && current()) {
        operation.current = false;
        setRemovalBusy(false);
      }
    }
  };
  const lastRating = last && !correction && (
    <div className="rv-last-rating">
      <p className="rv-help">{ru ? 'Последняя оценка' : 'Last rating'}</p>
      <strong lang="en">{last.after.front}</strong>
      <p>{RATING_LABELS[ru ? 'ru' : 'en'][last.review.rating - 1]}</p>
      <button
        type="button"
        className="rv-text-button"
        disabled={!ready || opening || cardBusy}
        onClick={() => void openCorrection()}
      >
        {opening
          ? ru
            ? 'Открываем карточку…'
            : 'Opening card…'
          : ru
            ? 'Изменить последнюю оценку'
            : 'Change last rating'}
      </button>
    </div>
  );
  const reading = (
    <Link
      className="rv-link-button rv-reading"
      to={readerReturnPath() ?? '/library'}
    >
      <AppIcon name="library" />
      {ru ? 'К чтению' : 'Back to reading'}
    </Link>
  );
  const maintenance = data && data.errors >= 20 && (
    <details className="rv-maintenance">
      <summary>
        {ru ? 'Карточки из прежних ошибок' : 'Cards from previous mistakes'} ·{' '}
        {data.errors}
      </summary>
      <p>
        {ru
          ? 'Их можно убрать отдельно от слов и фраз. История упражнений и прогресс курса останутся.'
          : 'Remove these separately from words and phrases. Exercise history and course progress remain.'}
      </p>
      <button
        type="button"
        className="rv-text-button rv-error"
        disabled={!ready || cardBusy || opening}
        onClick={() =>
          setRemoving(
            data.cards.filter((item) => item.fromError).map((item) => item.id)
          )
        }
      >
        {ru ? 'Убрать все старые ошибки' : 'Remove all old mistake cards'}
      </button>
    </details>
  );
  return (
    <section className="rv-page" aria-label={ru ? 'Повторение' : 'Review'}>
      <header className="rv-page-title">
        <div>
          <h1
            ref={heading}
            tabIndex={-1}
            aria-label={
              summary
                ? ru
                  ? 'Сессия завершена'
                  : 'Session finished'
                : undefined
            }
          >
            {summary
              ? ru
                ? 'Сессия завершена'
                : 'Session finished'
              : ru
                ? 'Повторение'
                : 'Review'}
          </h1>
          {!sessionView && !summary && (
            <p>
              {ru
                ? 'Немного внимания — и знакомые слова снова рядом.'
                : 'A little attention brings familiar words closer.'}
            </p>
          )}
        </div>
        <div className="rv-actions">
          {sessionView ? (
            <Button
              variant="ghost"
              disabled={cardBusy || opening}
              onClick={() => {
                setCorrection(null);
                setError('');
                navigate(path('/review'));
              }}
            >
              <ReviewIcon name="pause" />
              {ru ? 'На паузу' : 'Pause'}
            </Button>
          ) : (
            reading
          )}
        </div>
      </header>
      {resource.status !== 'ready' && (
        <div className="rv-recovery">
          <p role={resource.status === 'error' ? 'alert' : 'status'}>
            {resource.status === 'loading'
              ? ru
                ? 'Загружаем очередь…'
                : 'Loading the queue…'
              : resource.status === 'cancelled'
                ? ru
                  ? 'Загрузка отменена. Оценки и позиция сохранены.'
                  : 'Loading cancelled. Ratings and position are preserved.'
                : ru
                  ? 'Не удалось загрузить очередь. Ваши карточки не потеряны. Повторите загрузку.'
                  : 'Could not load the queue. Your cards are still there. Retry loading.'}
          </p>
          <div className="rv-actions">
            {resource.status === 'loading' ? (
              <Button variant="ghost" onClick={resource.cancel}>
                {ru ? 'Отмена' : 'Cancel loading'}
              </Button>
            ) : (
              <Button onClick={resource.retry}>
                {ru ? 'Повторить загрузку' : 'Retry loading'}
              </Button>
            )}
          </div>
        </div>
      )}
      {error && !removing && (
        <p role="alert" className="rv-error">
          {error}
        </p>
      )}
      {data && !sessionView && !summary && ready && (
        <ReviewOverview
          data={data}
          resume={Boolean(session && remaining.length)}
          skipped={Boolean(skipped.length)}
          onStart={start}
          maintenance={maintenance}
        />
      )}
      {session &&
        reviewed > 0 &&
        !sessionView &&
        !summary &&
        remaining.length === 0 &&
        ready && (
          <Button
            variant="ghost"
            onClick={() => navigate(path('/review/summary'))}
          >
            {ru ? 'Результат последней сессии' : 'Last session result'}
          </Button>
        )}
      {sessionView && card && (
        <div className="rv-session-layout">
          <div>
            <div className="rv-session-progress">
              <progress
                value={reviewed}
                max={session?.members.length || 1}
                aria-label={ru ? 'Оценено карточек' : 'Rated cards'}
              />
              <p>
                {ru
                  ? `Оценено ${reviewed} из ${session?.members.length}`
                  : `Rated ${reviewed} of ${session?.members.length}`}
              </p>
            </div>
            {correction && (
              <div className="rv-correction">
                <strong>
                  {ru
                    ? 'Изменение последней оценки'
                    : 'Changing the last rating'}
                </strong>
                <p>
                  {ru ? 'Предыдущая оценка' : 'Previous rating'}:{' '}
                  {
                    RATING_LABELS[ru ? 'ru' : 'en'][
                      correction.receipt.review.rating - 1
                    ]
                  }
                </p>
                <p>
                  {ru
                    ? 'Прежняя оценка действует, пока вы не сохраните новую.'
                    : 'The previous rating remains until you save a replacement.'}
                </p>
                <Button
                  variant="ghost"
                  disabled={cardBusy && !correctionError}
                  onClick={cancelCorrection}
                >
                  {ru ? 'Продолжить без изменения' : 'Continue without changes'}
                </Button>
              </div>
            )}
            <div
              ref={cardRegion}
              tabIndex={-1}
              aria-label={ru ? 'Текущая карточка' : 'Current card'}
              className="rv-card-region"
            >
              <ReviewCard
                key={`${session?.id}:${correction ? 'correction' : 'ordinary'}:${card.id}`}
                card={card}
                correction={correction?.receipt}
                initialRevealed={
                  !correction && Boolean(session?.revealed.includes(card.id))
                }
                onReveal={() => {
                  if (!correction)
                    updateReviewSession((previous) => ({
                      ...previous,
                      revealed: [...new Set([...previous.revealed, card.id])],
                    }));
                }}
                disabled={!ready || opening || removalBusy || correctionError}
                onBusyChange={changeBusy}
                onAdvance={graded}
                onSkip={() => {
                  updateReviewSession((previous) => ({
                    ...previous,
                    skipped: [...new Set([...previous.skipped, card.id])],
                  }));
                  focusPending.current = true;
                }}
              />
            </div>
            {!correction && card.fromError && (
              <button
                type="button"
                className="rv-text-button rv-error"
                disabled={!ready || cardBusy || opening}
                onClick={() => setRemoving([card.id])}
              >
                {ru ? 'Убрать из повторения' : 'Remove from review'}
              </button>
            )}
          </div>
          <aside className="rv-session-aside">
            <h2>{ru ? 'Эта сессия' : 'This session'}</h2>
            <dl className="rv-session-counts">
              {[
                [
                  ru ? 'Всего карточек' : 'Total cards',
                  session?.members.length ?? 0,
                ],
                [ru ? 'Оценено' : 'Rated', reviewed],
                [ru ? 'Осталось' : 'Remaining', remaining.length],
                [ru ? 'Пропущено' : 'Skipped', skipped.length],
                ...(unavailable
                  ? [
                      [
                        ru ? 'Больше не в очереди' : 'No longer due',
                        unavailable,
                      ],
                    ]
                  : []),
              ].map(([label, count]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{count}</dd>
                </div>
              ))}
            </dl>
            {lastRating}
            <p className="rv-help">
              {ru
                ? '«Снова» — оценка, если не вспомнили. Пропуск оставляет расписание прежним.'
                : 'Choose Again if you did not recall. Skipping leaves the schedule unchanged.'}
            </p>
          </aside>
        </div>
      )}
      {summary && session && ready && (
        <div className="rv-summary">
          <div className="rv-empty-mark">
            <AppIcon name="review" />
          </div>
          <p>
            {reviewed
              ? ru
                ? 'Вы уделили время знакомым словам. Это ещё один шаг к уверенному английскому.'
                : 'You gave familiar words some attention. Another step towards confident English.'
              : ru
                ? 'Этот проход закончен. Неоценённые карточки остаются в очереди.'
                : 'This pass is finished. Unrated cards remain due.'}
          </p>
          <dl className="rv-summary-counts">
            <div>
              <dt>{ru ? 'Оценено' : 'Rated'}</dt>
              <dd>
                {reviewed}
                <small> / {session.members.length}</small>
              </dd>
            </div>
            <div>
              <dt>{ru ? 'Пропущено' : 'Skipped'}</dt>
              <dd>{skipped.length}</dd>
            </div>
            {session.removed.length > 0 && (
              <div>
                <dt>{ru ? 'Убрано' : 'Removed'}</dt>
                <dd>{session.removed.length}</dd>
              </div>
            )}
            {unavailable > 0 && (
              <div>
                <dt>{ru ? 'Больше не в очереди' : 'No longer due'}</dt>
                <dd>{unavailable}</dd>
              </div>
            )}
          </dl>
          {reviewed > 0 && (
            <div className="rv-rating-breakdown">
              {RATING_LABELS[ru ? 'ru' : 'en'].map((label, index) => (
                <span key={label}>
                  {label}{' '}
                  <b>
                    {
                      session.receipts.filter(
                        (receipt) => receipt.review.rating === index + 1
                      ).length
                    }
                  </b>
                </span>
              ))}
            </div>
          )}
          <p>
            {skipped.length
              ? ru
                ? 'Пропущенные карточки остаются в очереди. Их расписание не изменилось.'
                : 'Skipped cards remain due. Their schedules have not changed.'
              : ru
                ? 'Оценки записаны. Следующее повторение определяется расписанием; завершение сессии не означает, что все слова уже выучены.'
                : 'Ratings are saved. The schedule determines the next review; finishing does not mean every word is learned.'}
          </p>
          <div className="rv-actions">
            {skipped.length > 0 ? (
              <Button onClick={start}>
                {ru ? 'Вернуться к пропущенным' : 'Return to skipped cards'}
              </Button>
            ) : (
              <Link className="rv-link-button" to="/">
                {ru ? 'К учебному пути' : 'Back to learning'}
              </Link>
            )}
            {reading}
            <Button variant="ghost" onClick={() => navigate(path('/review'))}>
              {ru ? 'К обзору повторения' : 'Review overview'}
            </Button>
          </div>
          {lastRating}
        </div>
      )}
      {removing && (
        <Dialog
          title={ru ? 'Убрать старые карточки?' : 'Remove old mistake cards?'}
          onClose={() => {
            if (!removalBusy) {
              setRemoving(null);
              setError('');
            }
          }}
        >
          <p className="rv-help">
            {ru
              ? `Убрать ${removing.length} карточек из прежних ошибок? Отменить будет нельзя. Слова, фразы и история упражнений останутся.`
              : `Remove ${removing.length} old mistake cards? This cannot be undone. Words, phrases and exercise history remain.`}
          </p>
          {error && (
            <p role="alert" className="rv-error">
              {error}
            </p>
          )}
          <div className="rv-actions">
            <Button disabled={removalBusy} onClick={() => void remove()}>
              {removalBusy
                ? ru
                  ? 'Убираем…'
                  : 'Removing…'
                : ru
                  ? 'Убрать'
                  : 'Remove'}
            </Button>
            <Button
              variant="ghost"
              disabled={removalBusy}
              onClick={() => {
                setRemoving(null);
                setError('');
              }}
            >
              {ru ? 'Отмена' : 'Cancel'}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
