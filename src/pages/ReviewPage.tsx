import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import type { SrsCard } from '@/db/db';
import { Button, Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  countErrorCards,
  dropAllErrorCards,
  dropCard,
  getDueCards,
  reviewCorrectionCard,
} from '@/features/srs/service';
import type { ReviewReceipt } from '@/features/srs/service';
import { ReviewCard } from '@/features/srs/ReviewCard';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { BackToReader } from '@/features/reader/BackToReader';
import { track } from '@/features/analytics/analytics';

const BULK_CLEAR_THRESHOLD = 20;
const RATING_LABELS = { ru: ['снова', 'трудно', 'хорошо', 'легко'], en: ['again', 'hard', 'good', 'easy'] };

export function ReviewPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [queue, setQueue] = useState<SrsCard[] | null>(null);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [errorCount, setErrorCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [scope, setScope] = useState(0);
  const [error, setError] = useState('');
  const [lastReview, setLastReview] = useState<ReviewReceipt | null>(null);
  const [correction, setCorrection] = useState<{ receipt: ReviewReceipt; card: SrsCard } | null>(null);
  const [opening, setOpening] = useState(false);
  const [cardBusy, setCardBusy] = useState(false);
  const operation = useRef(false);
  const reviewed = useRef(false);
  const completionTracked = useRef(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const cardBusyRef = useRef(false);
  const handleBusyChange = useCallback((busy: boolean) => { cardBusyRef.current = busy; setCardBusy(busy); }, []);
  const cardRegion = useRef<HTMLDivElement>(null);
  const [focusRevision, setFocusRevision] = useState(0);
  const focusCard = () => setFocusRevision(value => value + 1);
  useLayoutEffect(() => { if (focusRevision) cardRegion.current?.focus(); }, [focusRevision]);

  useEffect(
    () =>
      subscribeDataScope(() => {
        reviewed.current = false;
        completionTracked.current = false;
        setQueue(null);
        setFinished(new Set());
        setSkipped(new Set());
        setConfirmClear(false);
        setLastReview(null);
        setCorrection(null);
        setOpening(false);
        setCardBusy(false);
        cardBusyRef.current = false;
        operation.current = false;
        setError('');
        setScope((value) => value + 1);
      }),
    []
  );
  useEffect(() => {
    const current = captureDataScope();
    let members: Set<string> | null = null;
    const subscription = liveQuery(async () => ({
      cards: await getDueCards(),
      errors: await countErrorCards(),
    })).subscribe({
      next: ({ cards, errors }) => {
        if (!current()) return;
        const sessionMembers = (members ??= new Set(cards.map((c) => c.id)));
        setQueue(cards.filter((c) => sessionMembers.has(c.id)));
        setErrorCount(errors);
      },
      error: () => {
        if (current())
          setError(
            ru ? 'Не удалось загрузить очередь.' : 'Could not load the queue.'
          );
      },
    });
    return () => subscription.unsubscribe();
  }, [scope, ru]);

  const correctingReceipt = correction?.receipt;
  useEffect(() => {
    if (!correctingReceipt || cardBusy) return;
    const current = captureDataScope();
    const subscription = liveQuery(() => reviewCorrectionCard(correctingReceipt)).subscribe({
      next: row => {
        if (!current() || cardBusyRef.current) return;
        if (row) setCorrection(previous => previous?.receipt === correctingReceipt ? { ...previous, card: row } : previous);
        else {
          setCorrection(null);
          setLastReview(null);
          setError(ru ? 'Предыдущая карточка изменилась. Оценку изменить нельзя.' : 'The previous card changed. Its rating cannot be changed.');
        }
      },
      error: () => { if (current()) setError(ru ? 'Не удалось открыть карточку.' : 'Could not open the card.'); },
    });
    return () => subscription.unsubscribe();
  }, [correctingReceipt, cardBusy, ru]);

  const remaining = queue?.filter(
    (c) => !finished.has(c.id) && !skipped.has(c.id)
  );
  const skippedCount = queue?.filter((c) => skipped.has(c.id)).length ?? 0;
  const card = correction?.card ?? remaining?.[0];
  useEffect(() => {
    if (queue === null || card || correction || !reviewed.current || completionTracked.current || !lastReview?.currentScope()) return;
    completionTracked.current = true;
    void track('review_session_completed');
  }, [queue, card, correction, lastReview]);
  const advance = (id: string) =>
    setFinished((current) => new Set(current).add(id));
  const skip = (id: string) =>
    setSkipped((current) => new Set(current).add(id));
  const changeLastRating = async () => {
    if (!lastReview || operation.current || cardBusyRef.current) return;
    operation.current = true;
    setOpening(true);
    setError('');
    const current = captureDataScope();
    try {
      const previous = await reviewCorrectionCard(lastReview);
      if (!current() || !alive.current) return;
      if (previous) {
        setCorrection({ receipt: lastReview, card: previous });
        focusCard();
      } else {
        setLastReview(null);
        setError(ru ? 'Предыдущая карточка изменилась. Оценку изменить нельзя.' : 'The previous card changed. Its rating cannot be changed.');
      }
    } catch {
      if (current() && alive.current) setError(ru ? 'Не удалось открыть карточку. Попробуйте ещё раз.' : 'Could not open the card. Please try again.');
    } finally {
      if (current() && alive.current) { operation.current = false; setOpening(false); }
    }
  };
  const continueReview = () => { setCorrection(null); setError(''); focusCard(); };
  const graded = (receipt: ReviewReceipt) => {
    if (!alive.current || !receipt.currentScope()) return;
    setLastReview(receipt);
    if (correction) setCorrection(null);
    else { reviewed.current = true; advance(receipt.after.id); }
    setError('');
    focusCard();
  };
  const drop = async () => {
    if (!card) return;
    const current = captureDataScope();
    await dropCard(card.id);
    if (!current()) return;
    advance(card.id);
    setErrorCount(await countErrorCards());
  };
  const clearErrors = async () => {
    const current = captureDataScope();
    await dropAllErrorCards();
    if (!current()) return;
    setConfirmClear(false);
    setErrorCount(await countErrorCards());
    setQueue(await getDueCards());
  };

  return (
    <section aria-label={ru ? 'Повторение' : 'Review'}>
      <BackToReader />
      <Eyebrow className="mb-3.5">srs · review</Eyebrow>
      <div className="mb-8 flex items-center gap-3">
        <PixelImage
          src="/assets/pixel/nav/review.png"
          alt=""
          className="h-7 w-7 shrink-0"
        />
        <h1 className="text-2xl font-bold tracking-tight">
          {ru ? 'Очередь повторения' : 'Review queue'}
        </h1>
      </div>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      {queue === null && (
        <p className="font-mono text-sm text-muted">
          {ru ? 'загрузка…' : 'loading…'}
        </p>
      )}
      {lastReview && !correction && (
        <Button className="mb-4 min-h-11" variant="ghost" disabled={opening || cardBusy} onClick={() => void changeLastRating()}>
          {opening ? ru ? 'Открываем карточку…' : 'Opening card…' : ru ? 'Изменить последнюю оценку' : 'Change last rating'}
        </Button>
      )}
      {queue !== null && !card && (
        <div ref={cardRegion} tabIndex={-1} className="focus-visible:outline-2 focus-visible:outline-teal" aria-label={ru ? 'Сессия завершена' : 'Session finished'}><Card>
          <PixelImage
            src="/assets/pixel/ui/complete.png"
            alt=""
            className="mb-3 h-8 w-8"
          />
          <p className="font-mono text-sm text-teal">
            {skippedCount
              ? ru
                ? `Сессия завершена · пропущено: ${skippedCount}`
                : `Session finished · skipped: ${skippedCount}`
              : ru
                ? '✓ сессия завершена'
                : '✓ session finished'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {skippedCount
              ? ru
                ? 'Пропущенные карточки остаются в очереди. Их расписание не изменилось.'
                : 'Skipped cards remain due. Their schedules have not changed.'
              : ru
                ? 'Откройте повторение снова, чтобы начать следующую сессию.'
                : 'Open review again to start the next session.'}
          </p>
          {skippedCount > 0 && (
            <Button
              className="mt-3"
              variant="ghost"
              onClick={() => setSkipped(new Set())}
            >
              {ru ? 'Вернуться к пропущенным' : 'Return to skipped cards'}
            </Button>
          )}
        </Card></div>
      )}
      {card && (
        <div ref={cardRegion} tabIndex={-1} className="flex flex-col gap-4 focus-visible:outline-2 focus-visible:outline-teal" aria-label={ru ? 'Текущая карточка' : 'Current card'}>
          {correction && <div className="rounded-md border border-line bg-surface px-4 py-3">
            <p className="text-sm text-content">{ru ? 'Изменение последней оценки' : 'Changing the last rating'}</p>
            <p className="mt-1 text-sm text-muted">{ru ? 'Предыдущая оценка' : 'Previous rating'}: {RATING_LABELS[ru ? 'ru' : 'en'][correction.receipt.review.rating - 1]}</p>
            <p className="mt-1 text-sm text-muted">{ru ? 'Выберите новую оценку. До этого прежняя оценка остаётся в силе.' : 'Choose a replacement rating. The previous rating remains until then.'}</p>
            <Button className="mt-2 min-h-11" variant="ghost" disabled={cardBusy} onClick={continueReview}>{ru ? 'Продолжить без изменения' : 'Continue without changes'}</Button>
          </div>}
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {correction ? ru ? 'предыдущая карточка' : 'previous card' : `${remaining?.length} ${ru ? 'к повторению' : 'due'}`} ·{' '}
            {card.fromError
              ? ru
                ? 'из ошибки в упражнении'
                : 'from a missed exercise'
              : card.kind}
          </p>
          {!correction && errorCount >= BULK_CLEAR_THRESHOLD &&
            (confirmClear ? (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm text-content">
                  {ru
                    ? `Убрать ${errorCount} карточек из ошибок? Отменить будет нельзя.`
                    : `Remove ${errorCount} mistake cards? This cannot be undone.`}
                </span>
                <button
                  type="button"
                  className="font-mono text-2xs text-coral underline underline-offset-4"
                  onClick={() => void clearErrors()}
                >
                  {ru ? 'убрать' : 'remove'}
                </button>
                <button
                  type="button"
                  className="font-mono text-2xs text-muted underline underline-offset-4"
                  onClick={() => setConfirmClear(false)}
                >
                  {ru ? 'отмена' : 'cancel'}
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="self-start font-mono text-2xs text-muted underline underline-offset-4 transition-colors hover:text-coral"
                onClick={() => setConfirmClear(true)}
              >
                {ru
                  ? `убрать все карточки из ошибок (${errorCount})`
                  : `remove all mistake cards (${errorCount})`}
              </button>
            ))}
          <ReviewCard
            key={`${scope}:${correction ? 'correction' : 'ordinary'}:${card.id}`}
            card={card}
            correction={correction?.receipt}
            disabled={opening}
            onAdvance={graded}
            onSkip={correction ? continueReview : () => skip(card.id)}
            onBusyChange={handleBusyChange}
          />
          {!correction && card.fromError && (
            <button
              type="button"
              className="self-start font-mono text-2xs text-muted underline underline-offset-4 transition-colors hover:text-coral"
              onClick={() => void drop()}
            >
              {ru ? 'убрать из повторения' : 'remove from review'}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
