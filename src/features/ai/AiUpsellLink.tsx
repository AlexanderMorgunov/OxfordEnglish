import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';

/** Shown where an AI feature would appear when no key is configured — points the user to the
 *  AI section of Settings (scrolled into view via the #ai-section hash). */
export function AiUpsellLink({ className = '' }: { className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return (
    <Link
      to="/settings#ai-section"
      className={`inline-flex items-center font-mono text-2xs text-violet hover:underline ${className}`}
    >
      {ru ? 'Включить AI-функции →' : 'Enable AI features →'}
    </Link>
  );
}
