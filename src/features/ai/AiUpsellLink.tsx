import { useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAccount } from '@/features/account/store';
import { useEntitlement } from '@/features/account/entitlement';
import { upsellTarget } from './upsell';
import { useProActivation, type ProTask } from '@/features/account/proActivation';

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
export function AiUpsellLink({ className = '', children, task }: { className?: string; children?: ReactNode; task?: ProTask }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { pathname } = useLocation();
  const status = useAccount((s) => s.status);
  const entitlement = useEntitlement((s) => s.entitlement);
  const target = upsellTarget(status, entitlement);
  const open = useProActivation(s => s.open);
  const context = task ?? { source: pathname.startsWith('/library') ? 'reader' : pathname.startsWith('/vocabulary/text') ? 'text' : 'pro' };

  if (target === 'none' || target === 'unknown') return null;

  const cls = `inline-flex items-center font-mono text-2xs text-violet hover:underline ${className}`;

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
        <button type="button" onClick={e => open(context, pathname, e.currentTarget)} className={cls}>
          {ru ? 'Подробнее →' : 'Details →'}
        </button>
      </span>
    );
  }

  // No date here on purpose: the only one we have is the day the subscription ends, and offering it
  // as a refill date is exactly the promise this state exists to stop making.
  if (target === 'quota-until-renewal') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-mono text-2xs text-muted">
        <span>{ru ? 'ИИ-запросы израсходованы до продления' : 'AI budget spent until you extend'}</span>
        <button type="button" onClick={e => open(context, pathname, e.currentTarget)} className={cls}>
          {ru ? 'Продлить →' : 'Extend →'}
        </button>
      </span>
    );
  }

  if (target === 'quota-final') {
    return (
      <span className="inline-flex flex-wrap items-baseline gap-x-2 font-mono text-2xs text-muted">
        <span>{ru ? 'Запросы пробного периода израсходованы' : 'The trial budget is spent'}</span>
        <button type="button" onClick={e => open(context, pathname, e.currentTarget)} className={cls}>
          {ru ? 'Что дальше →' : 'What now →'}
        </button>
      </span>
    );
  }

  return (
    <button type="button" onClick={e => open(context, pathname, e.currentTarget)} className={cls}>
      {children ?? (ru ? 'Разборы на основе ИИ →' : 'AI explanations →')}
    </button>
  );
}
