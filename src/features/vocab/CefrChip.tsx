import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { CEFR_LEVELS } from './cefr';

const LEARNER_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Five-dot usefulness scale anchored to CEFR (A1 ●●●●● … unlisted ●○○○○ C1+), coloured against the
 *  learner's level: at or below it teal, one step up amber, further ahead muted. */
export function CefrChip({ level, className }: { level: number | null; className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const learner = useLearner((s) => s.level);
  const idx = level ?? CEFR_LEVELS.length;
  const step = idx - (learner ? LEARNER_LEVELS.indexOf(learner) : 1);
  const hint =
    step <= 0
      ? ru
        ? 'по вашему уровню'
        : 'at your level'
      : step === 1
        ? ru
          ? 'следующий шаг'
          : 'next step'
        : ru
          ? 'на вырост'
          : 'further ahead';
  const name = level == null ? 'C1+' : CEFR_LEVELS[level];
  return (
    <span
      title={`${name} · ${hint}`}
      className={cn(
        'whitespace-nowrap font-mono text-2xs',
        step <= 0 ? 'text-teal' : step === 1 ? 'text-amber' : 'text-muted',
        className
      )}
    >
      <span aria-hidden>
        {'●'.repeat(5 - idx)}
        {'○'.repeat(idx)}
      </span>{' '}
      {name}
      <span className="sr-only"> — {hint}</span>
    </span>
  );
}
