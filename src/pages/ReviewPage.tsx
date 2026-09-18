import { useEffect, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { Button, Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { canSpeak, speakWord } from '@/shared/lib/audio';
import { translateText, translateWord } from '@/features/vocab/translate';
import { canPronounce, dropCard, gradeCard, getDueCards, repairCardBack, Rating } from '@/features/srs/service';
import { BackToReader } from '@/features/reader/BackToReader';

const GRADES = [
  { rating: Rating.Again, ru: 'снова', en: 'again' },
  { rating: Rating.Hard, ru: 'трудно', en: 'hard' },
  { rating: Rating.Good, ru: 'хорошо', en: 'good' },
  { rating: Rating.Easy, ru: 'легко', en: 'easy' },
] as const;

export function ReviewPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [queue, setQueue] = useState<SrsCard[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [extra, setExtra] = useState<string | null>(null);
  const [lookedUp, setLookedUp] = useState(false);

  useEffect(() => {
    void getDueCards().then(setQueue);
  }, []);

  const card = queue?.[index];

  /**
   * A card whose `back` equals its `front` was saved while the lookup was unavailable, so it has no
   * translation to show. Retry it here and WRITE IT BACK: before, the answer lived in component state
   * only, so the same card asked the network on every showing and fell back to a bare dash whenever it
   * could not reach it. Phrases were never retried at all, so theirs was a dash for good.
   *
   * Skipped for mistake cards: their `front` is an exercise prompt, not a term to look up.
   */
  const reveal = () => {
    setRevealed(true);
    if (!card || card.back !== card.front || card.fromError) return;
    const lookup = card.kind === 'word' ? translateWord : translateText;
    void lookup(card.front).then((ru) => {
      setExtra(ru);
      setLookedUp(true);
      if (ru) void repairCardBack(card.id, ru);
    });
  };

  /** Removes for good rather than for now: a hard delete left the row on the server and the next pull
   *  put the card straight back, so the same card was dismissed over and over. */
  const drop = async () => {
    if (!card) return;
    await dropCard(card.id);
    setRevealed(false);
    setExtra(null);
    setLookedUp(false);
    setQueue((cur) => cur?.filter((c) => c.id !== card.id) ?? cur);
  };

  const grade = async (rating: Grade) => {
    if (!card) return;
    await gradeCard(card.id, rating);
    setRevealed(false);
    setExtra(null);
    setLookedUp(false);
    setIndex((i) => i + 1);
  };

  return (
    <section aria-label={ru ? 'Повторение' : 'Review'}>
      <BackToReader />
      <Eyebrow className="mb-3.5">srs · review</Eyebrow>
      <div className="mb-8 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/review.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">
          {ru ? 'Очередь повторения' : 'Review queue'}
        </h1>
      </div>

      {queue === null && <p className="font-mono text-sm text-muted">{ru ? 'загрузка…' : 'loading…'}</p>}

      {queue !== null && !card && (
        <Card>
          <PixelImage src="/assets/pixel/ui/complete.png" alt="" className="mb-3 h-8 w-8" />
          <p className="font-mono text-sm text-teal">
            {ru ? '✓ всё повторено — ничего не ждёт' : "✓ nothing due — you're clear"}
          </p>
          <p className="mt-2 text-sm text-muted">
            {ru
              ? 'Карточки появляются здесь, когда вы отмечаете слова для повторения и ошибаетесь в упражнениях. Возвращайтесь, когда они будут назначены.'
              : "Cards appear here as you mark words for review and make mistakes in practice. Come back when they're scheduled."}
          </p>
        </Card>
      )}

      {card && (
        <div className="flex flex-col gap-4">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {queue.length - index} {ru ? 'к повторению' : 'due'} ·{' '}
            {card.fromError ? (ru ? 'из ошибки в упражнении' : 'from a missed exercise') : card.kind}
          </p>
          <Card className="min-h-40">
            <div className="flex items-center gap-2.5">
              <p className="font-mono text-2xl text-content">{card.front}</p>
              {canPronounce(card) && canSpeak() && (
                <button
                  type="button"
                  aria-label={`${ru ? 'Произнести' : 'Pronounce'} ${card.front}`}
                  className="text-xl text-teal transition-opacity hover:opacity-80"
                  onClick={() => speakWord(card.front)}
                >
                  🔊
                </button>
              )}
            </div>
            {revealed && (
              <div className="mt-4 border-t border-line pt-4">
                <p className={`text-lg ${card.back !== card.front || extra ? 'text-content' : 'text-muted'}`}>
                  {card.back !== card.front
                    ? card.back
                    : (extra ??
                      (lookedUp
                        ? ru
                          ? 'Перевод не загрузился — попробуем в следующий раз'
                          : 'Translation unavailable — we will try again next time'
                        : '…'))}
                </p>
                {card.contextGloss && (
                  <p className="mt-1.5 text-sm text-content">
                    <span className="mr-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
                      {ru ? 'в контексте' : 'in context'}
                    </span>
                    {card.contextGloss}
                  </p>
                )}
                {card.contextSentence && (
                  <p className="mt-2 text-sm text-muted">{card.contextSentence}</p>
                )}
                {/* Mistake cards are the only ones with nowhere else to manage them: the lexicon skips
                    them, so without this the queue is the one place they appear and cannot be left. */}
                {card.fromError && (
                  <button
                    type="button"
                    className="mt-3 font-mono text-2xs text-muted underline underline-offset-4 transition-colors hover:text-coral"
                    onClick={() => void drop()}
                  >
                    {ru ? 'убрать из повторения' : 'remove from review'}
                  </button>
                )}
              </div>
            )}
          </Card>

          {revealed ? (
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label={ru ? 'Оцените карточку' : 'Grade the card'}
            >
              {GRADES.map((g) => (
                <Button key={g.en} variant="ghost" onClick={() => void grade(g.rating)}>
                  {ru ? g.ru : g.en}
                </Button>
              ))}
            </div>
          ) : (
            <Button onClick={reveal}>{ru ? 'Показать ответ' : 'Show answer'}</Button>
          )}
        </div>
      )}
    </section>
  );
}
