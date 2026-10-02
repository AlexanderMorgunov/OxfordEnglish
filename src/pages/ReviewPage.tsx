import { useEffect, useState } from 'react';
import { liveQuery } from 'dexie';
import type { SrsCard } from '@/db/db';
import { Button, Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  countErrorCards,
  dropAllErrorCards,
  dropCard,
  getDueCards,
} from '@/features/srs/service';
import { ReviewCard } from '@/features/srs/ReviewCard';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { BackToReader } from '@/features/reader/BackToReader';

const BULK_CLEAR_THRESHOLD = 20;

export function ReviewPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [queue, setQueue] = useState<SrsCard[] | null>(null);
  const [finished, setFinished] = useState<Set<string>>(new Set());
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [errorCount, setErrorCount] = useState(0);
  const [confirmClear, setConfirmClear] = useState(false);
  const [scope, setScope] = useState(0);
  const [error, setError] = useState('');

  useEffect(
    () =>
      subscribeDataScope(() => {
        setQueue(null);
        setFinished(new Set());
        setSkipped(new Set());
        setConfirmClear(false);
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

  const remaining = queue?.filter(
    (c) => !finished.has(c.id) && !skipped.has(c.id)
  );
  const skippedCount = queue?.filter((c) => skipped.has(c.id)).length ?? 0;
  const card = remaining?.[0];
  const advance = (id: string) =>
    setFinished((current) => new Set(current).add(id));
  const skip = (id: string) =>
    setSkipped((current) => new Set(current).add(id));
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
      {queue !== null && !card && (
        <Card>
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
        </Card>
      )}
      {card && (
        <div className="flex flex-col gap-4">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {remaining?.length} {ru ? 'к повторению' : 'due'} ·{' '}
            {card.fromError
              ? ru
                ? 'из ошибки в упражнении'
                : 'from a missed exercise'
              : card.kind}
          </p>
          {errorCount >= BULK_CLEAR_THRESHOLD &&
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
            key={`${scope}:${card.id}`}
            card={card}
            onAdvance={() => advance(card.id)}
            onSkip={() => skip(card.id)}
          />
          {card.fromError && (
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
