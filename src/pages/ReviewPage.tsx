import { useEffect, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { Button, Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { canSpeak, speakWord } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { gradeCard, getDueCards, Rating } from '@/features/srs/service';

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

  useEffect(() => {
    void getDueCards().then(setQueue);
  }, []);

  const card = queue?.[index];

  const reveal = () => {
    setRevealed(true);
    if (card && card.kind === 'word' && card.back === card.front) {
      void translateWord(card.front).then(setExtra);
    }
  };

  const grade = async (rating: Grade) => {
    if (!card) return;
    await gradeCard(card.id, rating);
    setRevealed(false);
    setExtra(null);
    setIndex((i) => i + 1);
  };

  return (
    <section aria-label={ru ? 'Повторение' : 'Review'}>
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
            {card.fromError ? (ru ? 'ошибка' : 'mistake') : card.kind}
          </p>
          <Card className="min-h-40">
            <div className="flex items-center gap-2.5">
              <p className="font-mono text-2xl text-content">{card.front}</p>
              {card.kind === 'word' && canSpeak() && (
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
                <p className="text-lg text-content">
                  {card.back !== card.front
                    ? card.back
                    : (extra ?? '—')}
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
