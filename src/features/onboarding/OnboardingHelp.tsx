import { useUiLang } from '@/features/i18n/uiLang';
import { useOnboarding } from './state';

export function OnboardingHelp({
  reader = false,
  probe = false,
}: {
  reader?: boolean;
  probe?: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { context, ready, start } = useOnboarding();
  if (probe) return <span className="ct-help">?</span>;
  if (!context || (context.key === 'reader') !== reader) return null;
  return (
    <button
      type="button"
      className="ct-help"
      disabled={!ready}
      aria-busy={!ready}
      aria-label={`${ru ? 'Подсказки' : 'Help'}: ${context.title}`}
      title={
        ru ? 'Показать подсказки этой страницы' : 'Show help for this page'
      }
      onClick={(event) => start?.(event.currentTarget)}
    >
      ?
    </button>
  );
}
