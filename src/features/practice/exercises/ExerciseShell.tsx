import { useState, type ReactNode } from 'react';
import type { LocalizedText } from '@/content/schema';
import { AiAction } from '@/features/ai/AiAction';
import { explainError, hint as aiHint } from '@/features/ai/functions';
import type { ExerciseStatus } from './shared';

export type AiContext = {
  prompt: string;
  userAnswer: string;
  correct: string;
  topic: string;
};

type ExerciseShellProps = {
  instruction: LocalizedText;
  hint?: LocalizedText;
  explanation?: LocalizedText;
  status: ExerciseStatus;
  onRevealHint?: () => void;
  children: ReactNode;
  feedback?: ReactNode;
  aiContext?: AiContext;
};

export function ExerciseShell({
  instruction,
  hint,
  explanation,
  status,
  onRevealHint,
  children,
  feedback,
  aiContext,
}: ExerciseShellProps) {
  const [showHint, setShowHint] = useState(false);
  return (
    <div className="card-exercise" role="group" aria-label={instruction.en}>
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <p className="text-base leading-relaxed">{instruction.en}</p>
        {hint && !showHint && (
          <button
            type="button"
            className="shrink-0 font-mono text-2xs uppercase tracking-[0.08em] text-amber hover:underline"
            onClick={() => {
              setShowHint(true);
              onRevealHint?.();
            }}
          >
            hint
          </button>
        )}
      </div>
      {showHint && hint && (
        <p className="mb-3.5 font-mono text-sm text-amber">{hint.en}</p>
      )}
      {children}
      {feedback}
      {status === 'correct' && explanation && (
        <p className="mt-3 text-sm text-muted">{explanation.en}</p>
      )}
      {aiContext && status !== 'correct' && (
        <div className="mt-3 flex flex-col gap-2">
          {status === 'idle' && (
            <AiAction
              label="hint (AI)"
              run={(config) =>
                aiHint(config, { prompt: aiContext.prompt, topic: aiContext.topic })
              }
            />
          )}
          {status === 'incorrect' && (
            <AiAction
              label="why is it wrong? (AI)"
              run={(config) => explainError(config, aiContext)}
            />
          )}
        </div>
      )}
    </div>
  );
}
