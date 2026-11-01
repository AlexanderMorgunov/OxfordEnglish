import { useUiLang } from '@/features/i18n/uiLang';
import { CEFR_LEVELS } from './cefr';
import type { CefrHit } from './cefr';

export function VocabularyRating({ hit }: { hit: CefrHit | null }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  if (!hit)
    return (
      <span className="vc-rating vc-rating-unknown">
        {ru ? 'Нет оценки' : 'Unrated'}
      </span>
    );
  const level = CEFR_LEVELS[hit.level],
    score = Math.max(1, 5 - hit.level);
  const label = ru
    ? `Полезность по уровню: ${score} из 5, ${level}. Условный ориентир, не точная частотность.`
    : `CEFR usefulness: ${score} of 5, ${level}. An approximate guide, not exact frequency.`;
  return (
    <span className="vc-rating" role="img" aria-label={label} title={label}>
      <svg viewBox="0 0 55 12" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <circle
            key={index}
            cx={5 + index * 11}
            cy="6"
            r="3.5"
            fill={index < score ? 'currentColor' : 'none'}
            stroke="currentColor"
            strokeWidth="1.2"
          />
        ))}
      </svg>
      <span>{level}</span>
    </span>
  );
}
