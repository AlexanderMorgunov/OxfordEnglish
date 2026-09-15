import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { upsellTarget } from './upsell';

/**
 * Shown where an AI feature would appear but cannot run. What it says depends on WHY — see
 * `upsellTarget`. The single fixed link this replaces pointed everyone at the BYOK form in Settings,
 * including a paying subscriber who had merely used up the month's budget; that person was being told
 * to go and set up AI they had already bought.
 *
 * Says nothing at all in two cases: when an AI path exists (the caller should not have rendered it),
 * and when the plan could not be read. Silence is right for the second — entitlement is never cached,
 * so a subscriber offline or on a cold start lands there, and guessing out loud would repeat the very
 * bug above.
 */
export function AiUpsellLink({ className = '' }: { className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { pathname } = useLocation();
  const status = useAccount((s) => s.status);
  const entitlement = useEntitlement((s) => s.entitlement);
  const target = upsellTarget(status, entitlement);

  if (target === 'none' || target === 'unknown') return null;

  const cls = `inline-flex items-center font-mono text-2xs text-violet hover:underline ${className}`;
  // `?from=reader` is what BackToReader looks for, so a lookup from a book can get back to the page.
  const from = pathname.startsWith('/library') ? '?from=reader' : '';

  if (target === 'quota-resets') {
    const resets = entitlement?.ai.resetsAt
      ? new Date(entitlement.ai.resetsAt).toLocaleDateString(ru ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long' })
      : null;
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-mono text-2xs text-muted">
        <span>
          {resets
            ? ru
              ? `ИИ-запросы израсходованы, обновятся ${resets}`
              : `AI budget spent, resets on ${resets}`
            : ru
              ? 'ИИ-запросы израсходованы'
              : 'AI budget spent'}
        </span>
        <Link to={`/settings?from=${encodeURIComponent(pathname)}#ai-section`} className={cls}>
          {ru ? 'Свой ключ →' : 'Use your own key →'}
        </Link>
      </span>
    );
  }

  if (target === 'quota-final') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-mono text-2xs text-muted">
        <span>{ru ? 'Запросы пробного периода израсходованы' : 'The trial budget is spent'}</span>
        <Link to={`/pro${from}`} className={cls}>
          {ru ? 'Что дальше →' : 'What now →'}
        </Link>
      </span>
    );
  }

  return (
    <Link to={`/pro${from}`} className={cls}>
      {ru ? 'Разборы на основе ИИ →' : 'AI explanations →'}
    </Link>
  );
}
