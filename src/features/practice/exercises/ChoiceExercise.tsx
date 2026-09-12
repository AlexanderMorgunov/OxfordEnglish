import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Console, Option } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useExerciseAttempt, type ExerciseStatus } from './shared';
import { useShuffledOptions } from '../useShuffledOptions';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'choice' }>;
  onSolved?: () => void;
};

function optionState(
  i: number,
  chosen: number | null,
  correctIndex: number,
  status: ExerciseStatus
) {
  if (status === 'correct' && i === correctIndex) return 'correct' as const;
  if (i === chosen && i !== correctIndex) return 'wrong' as const;
  return 'default' as const;
}

export function ChoiceExercise({ exercise, onSolved }: Props) {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const [chosen, setChosen] = useState<number | null>(null);
  const attempt = useExerciseAttempt(exercise, onSolved);
  const { status, submit } = attempt;
  const [before, after] = exercise.prompt.split(/_{2,}/);
  // `chosen`/`correctAt` are on-screen positions; `original` maps back to the authored options.
  const { items, correctAt } = useShuffledOptions(exercise.options, exercise.correctIndex);

  const pick = (i: number) => {
    if (status === 'correct') return;
    setChosen(i);
    const original = items[i]?.original ?? -1;
    submit(original === exercise.correctIndex, exercise.options[original] ?? '', {
      front: exercise.prompt,
      back: exercise.options[exercise.correctIndex] ?? '',
    });
  };

  return (
    <ExerciseShell
      exercise={exercise}
      attempt={attempt}
      ai={{
        prompt: exercise.prompt,
        userAnswer: chosen !== null ? (exercise.options[items[chosen]?.original ?? -1] ?? '') : '',
        correct: exercise.options[exercise.correctIndex] ?? '',
      }}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? ru
                ? `✓ верно — правильный ответ: ${exercise.options[exercise.correctIndex]}`
                : `✓ passed — correct answer: ${exercise.options[exercise.correctIndex]}`
              : ru
                ? '✕ не то — продолжайте'
                : '✕ not quite — keep going'}
          </Console>
        )
      }
    >
      <p className="mb-3.5 text-base">
        {before}
        <span className="text-faint">____</span>
        {after}
      </p>
      <div
        className="flex flex-wrap gap-2"
        onKeyDown={(e) => {
          const n = Number(e.key);
          if (n >= 1 && n <= items.length) pick(n - 1);
        }}
      >
        {items.map((opt, i) => (
          <Option
            key={opt.original}
            disabled={status === 'correct'}
            state={optionState(i, chosen, correctAt, status)}
            onClick={() => pick(i)}
          >
            <span className="text-faint">{i + 1}.</span> {opt.text}
          </Option>
        ))}
      </div>
    </ExerciseShell>
  );
}
