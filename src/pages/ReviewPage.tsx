import { useEffect, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { Button, Card, Eyebrow } from '@/shared/ui';
import { canSpeak, speakWord } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { gradeCard, getDueCards, Rating } from '@/features/srs/service';

const GRADES = [
  { rating: Rating.Again, label: 'again' },
  { rating: Rating.Hard, label: 'hard' },
  { rating: Rating.Good, label: 'good' },
  { rating: Rating.Easy, label: 'easy' },
] as const;

export function ReviewPage() {
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
    <section aria-label="Review">
      <Eyebrow className="mb-3.5">srs · review</Eyebrow>
      <h1 className="mb-8 text-2xl font-bold tracking-tight">Review queue</h1>

      {queue === null && <p className="font-mono text-sm text-muted">loading…</p>}

      {queue !== null && !card && (
        <Card>
          <p className="font-mono text-sm text-teal">✓ nothing due — you're clear</p>
          <p className="mt-2 text-sm text-muted">
            Cards appear here as you mark words for review and make mistakes in
            practice. Come back when they're scheduled.
          </p>
        </Card>
      )}

      {card && (
        <div className="flex flex-col gap-4">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {queue.length - index} due · {card.fromError ? 'mistake' : card.kind}
          </p>
          <Card className="min-h-40">
            <div className="flex items-center gap-2.5">
              <p className="font-mono text-2xl text-content">{card.front}</p>
              {card.kind === 'word' && canSpeak() && (
                <button
                  type="button"
                  aria-label={`Pronounce ${card.front}`}
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
              aria-label="Grade the card"
            >
              {GRADES.map((g) => (
                <Button key={g.label} variant="ghost" onClick={() => void grade(g.rating)}>
                  {g.label}
                </Button>
              ))}
            </div>
          ) : (
            <Button onClick={reveal}>Show answer</Button>
          )}
        </div>
      )}
    </section>
  );
}
