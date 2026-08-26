import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Console, Option } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useExerciseAttempt, type ExerciseStatus } from './shared';
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

  const pick = (i: number) => {
    if (status === 'correct') return;
    setChosen(i);
    submit(i === exercise.correctIndex, exercise.options[i] ?? '', {
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
        userAnswer: chosen !== null ? (exercise.options[chosen] ?? '') : '',
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
          if (n >= 1 && n <= exercise.options.length) pick(n - 1);
        }}
      >
        {exercise.options.map((opt, i) => (
          <Option
            key={opt}
            disabled={status === 'correct'}
            state={optionState(i, chosen, exercise.correctIndex, status)}
            onClick={() => pick(i)}
          >
            <span className="text-faint">{i + 1}.</span> {opt}
          </Option>
        ))}
      </div>
    </ExerciseShell>
  );
}
