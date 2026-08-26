import { useState, type ReactNode } from 'react';
import type { Exercise } from '@/content/schema';
import { AiAction } from '@/features/ai/AiAction';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { isConfigured, useAiStore } from '@/features/ai/store';
import { explainError, hint as aiHint } from '@/features/ai/functions';
import { useUiLang, tr } from '@/features/i18n/uiLang';
import { exLabels } from '@/features/i18n/ui-strings';
import { matchCommonError } from '../normalize';
import type { ExerciseAttempt } from './shared';

/** Types with a free-text/ordered answer, where a typical-error bank and a
 * reveal button make sense (unlike choice/spot-error/minimal-pairs). */
const FREE_INPUT = new Set(['gap-fill', 'translate', 'transform', 'order-words', 'dictation']);

export type AiContext = { prompt: string; userAnswer: string; correct: string };

type ExerciseShellProps = {
  exercise: Exercise;
  attempt: ExerciseAttempt;
  ai?: AiContext;
  children: ReactNode;
  feedback?: ReactNode;
};

export function ExerciseShell({
  exercise,
  attempt,
  ai,
  children,
  feedback,
}: ExerciseShellProps) {
  const { status, attempts, canReveal, aiHintsLeft, noteAiHint, revealHint } = attempt;
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const L = exLabels(lang);
  const aiConfigured = isConfigured(useAiStore((s) => s.config));
  const [showHint, setShowHint] = useState(false);
  const [showAnswer, setShowAnswer] = useState(false);

  const freeInput = FREE_INPUT.has(exercise.type);
  const caseSensitive = exercise.type === 'gap-fill' ? exercise.caseSensitive : undefined;
  const commonError =
    freeInput && status === 'incorrect' && ai?.userAnswer
      ? matchCommonError(ai.userAnswer, exercise.commonErrors, { caseSensitive })
      : undefined;
  const topic = exercise.tags[0] ?? 'grammar';

  return (
    <div className="card-exercise" role="group" aria-label={tr(exercise.instruction, lang)}>
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <p className="text-base leading-relaxed">{tr(exercise.instruction, lang)}</p>
        {exercise.hint && !showHint && (
          <button
            type="button"
            className="shrink-0 font-mono text-2xs uppercase tracking-[0.08em] text-amber hover:underline"
            onClick={() => {
              setShowHint(true);
              revealHint();
            }}
          >
            {L.hint}
          </button>
        )}
      </div>
      {showHint && exercise.hint && (
        <p className="mb-3.5 font-mono text-sm text-amber">{tr(exercise.hint, lang)}</p>
      )}
      {children}
      {feedback}

      {commonError && (
        <p className="mt-3 rounded-sm border-l-[3px] border-amber bg-amber-dim/15 px-3.5 py-2.5 text-sm leading-relaxed">
          {tr(commonError.explanation, lang)}
        </p>
      )}

      {status === 'correct' && exercise.explanation && (
        <p className="mt-3 text-sm text-muted">{tr(exercise.explanation, lang)}</p>
      )}

      {freeInput && ai?.correct && (canReveal || showAnswer) && (
        <div className="mt-3">
          {!showAnswer ? (
            <button
              type="button"
              className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
              onClick={() => setShowAnswer(true)}
            >
              {lang === 'ru' ? 'показать ответ' : 'show answer'}
            </button>
          ) : (
            <p className="rounded-sm border-l-[3px] border-teal-dim bg-surface-2 px-3.5 py-2.5 text-sm">
              {lang === 'ru' ? 'Правильный ответ: ' : 'Correct answer: '}
              <span className="font-mono text-teal">{ai.correct}</span>
            </p>
          )}
        </div>
      )}

      {ai &&
        status !== 'correct' &&
        (aiConfigured ? (
          <div className="mt-3 flex flex-col gap-2">
            {aiHintsLeft > 0 && (
              <AiAction
                label={
                  (ru ? 'подсказка (AI)' : 'hint (AI)') +
                  (status === 'idle' ? '' : ` · ${aiHintsLeft}`)
                }
                onRun={noteAiHint}
                run={(config) =>
                  aiHint(config, {
                    prompt: ai.prompt,
                    topic,
                    userAnswer: status === 'incorrect' ? ai.userAnswer : undefined,
                    attempt: attempts.length,
                  })
                }
              />
            )}
            {status === 'incorrect' && (
              <AiAction
                label={ru ? 'почему неверно? (AI)' : 'why is it wrong? (AI)'}
                run={(config) =>
                  explainError(config, {
                    prompt: ai.prompt,
                    userAnswer: ai.userAnswer,
                    correct: ai.correct,
                    topic,
                    attempts,
                  })
                }
              />
            )}
          </div>
        ) : (
          <div className="mt-3">
            <AiUpsellLink />
          </div>
        ))}
    </div>
  );
}
