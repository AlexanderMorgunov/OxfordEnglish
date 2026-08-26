import { useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Console, Input } from '@/shared/ui';
import { checkAnswer } from '../normalize';
import { useUiLang } from '@/features/i18n/uiLang';
import { exLabels } from '@/features/i18n/ui-strings';
import { useExerciseAttempt } from './shared';
import { ExerciseShell } from './ExerciseShell';

type Props = {
  exercise: Extract<Exercise, { type: 'translate' }>;
  onSolved?: () => void;
};

export function TranslateExercise({ exercise, onSolved }: Props) {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const [value, setValue] = useState('');
  const attempt = useExerciseAttempt(exercise, onSolved);
  const { status, submit } = attempt;

  const check = () => {
    if (!value.trim() || status === 'correct') return;
    submit(checkAnswer(value, exercise.answers), value, {
      front: exercise.prompt,
      back: exercise.answers[0] ?? '',
    });
  };

  return (
    <ExerciseShell
      exercise={exercise}
      attempt={attempt}
      ai={{
        prompt: `Translate (${exercise.direction}): ${exercise.prompt}`,
        userAnswer: value,
        correct: exercise.answers[0] ?? '',
      }}
      feedback={
        status !== 'idle' && (
          <Console status={status === 'correct' ? 'pass' : 'fail'}>
            {status === 'correct'
              ? `✓ верно — напр. "${exercise.answers[0]}"`
              : ru
                ? '✕ пока не совпадает — ещё раз'
                : '✕ not a match yet — try again'}
          </Console>
        )
      }
    >
      <p className="mb-3.5 text-lg">
        {exercise.prompt}
        <span className="ml-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
          {exercise.direction}
        </span>
      </p>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder={ru ? 'ваш перевод…' : 'your translation…'}
          value={value}
          disabled={status === 'correct'}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && check()}
        />
        <Button onClick={check} disabled={status === 'correct'}>
          {exLabels(lang).runCheck}
        </Button>
      </div>
    </ExerciseShell>
  );
}
