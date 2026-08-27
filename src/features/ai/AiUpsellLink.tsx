import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';

/** Shown where an AI feature would appear when no key is configured — points the user to the
 *  AI section of Settings (scrolled into view via the #ai-section hash). Carries the current page
 *  as `?from=` so Settings can offer a "back" link that returns here (progress is kept). */
export function AiUpsellLink({ className = '' }: { className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { pathname } = useLocation();
  return (
    <Link
      to={`/settings?from=${encodeURIComponent(pathname)}#ai-section`}
      className={`inline-flex items-center font-mono text-2xs text-violet hover:underline ${className}`}
    >
      {ru ? 'Включить AI-функции →' : 'Enable AI features →'}
    </Link>
  );
}
