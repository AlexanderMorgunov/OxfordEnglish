import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';

/** Illustrative next-review intervals per grade — the app schedules with FSRS from your own history. */
const GRADES = [
  { id: 'again', ru: 'снова', en: 'again', next: { ru: 'через 10 минут', en: 'in 10 minutes' }, tone: 'coral' },
  { id: 'hard', ru: 'трудно', en: 'hard', next: { ru: 'завтра', en: 'tomorrow' }, tone: 'amber' },
  { id: 'good', ru: 'хорошо', en: 'good', next: { ru: 'через 3 дня', en: 'in 3 days' }, tone: 'teal' },
  { id: 'easy', ru: 'легко', en: 'easy', next: { ru: 'через 6 дней', en: 'in 6 days' }, tone: 'teal' },
] as const;

export function ReviewDemo() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [revealed, setRevealed] = useState(false);
  const [graded, setGraded] = useState<(typeof GRADES)[number] | null>(null);

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
        {ru ? 'карточка повторения' : 'a review card'}
      </p>
      <div className="rounded-md border border-line bg-ink p-4 text-center">
        <p className="font-mono text-xl text-content">curious</p>
        <p
          className={cn(
            'mt-2 text-sm transition-opacity duration-200',
            revealed ? 'text-muted opacity-100' : 'opacity-0'
          )}
        >
          {ru ? 'любопытный' : 'eager to know something'}
        </p>
      </div>

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="mt-3 w-full rounded-sm border border-teal-dim px-3 py-2 font-mono text-xs text-teal transition-colors hover:border-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {ru ? 'Показать перевод' : 'Show the translation'}
        </button>
      ) : (
        <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label={ru ? 'Оценка' : 'Grade'}>
          {GRADES.map((g) => (
            <button
              key={g.id}
              type="button"
              aria-pressed={graded?.id === g.id}
              onClick={() => setGraded(g)}
              className={cn(
                'flex-1 rounded-sm border px-2 py-1.5 font-mono text-2xs transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
                graded?.id === g.id
                  ? g.tone === 'coral'
                    ? 'border-coral text-coral'
                    : g.tone === 'amber'
                      ? 'border-amber text-amber'
                      : 'border-teal text-teal'
                  : 'border-line text-muted hover:text-content'
              )}
            >
              {ru ? g.ru : g.en}
            </button>
          ))}
        </div>
      )}

      <p aria-live="polite" className="mt-3 font-mono text-2xs text-muted">
        {graded
          ? ru
            ? `Следующий показ: ${graded.next.ru}. Интервал считает FSRS по вашей истории ответов.`
            : `Next review: ${graded.next.en}. FSRS sets the interval from your own answer history.`
          : ru
            ? 'Чем увереннее ответ, тем позже слово вернётся.'
            : 'The more confident the answer, the later the word comes back.'}
      </p>
    </div>
  );
}
