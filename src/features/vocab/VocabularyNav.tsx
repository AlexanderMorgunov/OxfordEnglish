import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { VocabularyIcon } from './VocabularySpeech';
import { withReaderReturn } from '@/features/reader/return-to-reader';
import './vocabulary.css';

export function VocabularyNav() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  return (
    <nav
      aria-label={ru ? 'Разделы словаря' : 'Vocabulary sections'}
      className="vc-tabs"
    >
      {[
        { to: '/vocabulary', label: ru ? 'Мой словарь' : 'My vocabulary' },
        {
          to: '/vocabulary/text',
          label: ru ? 'Перевод текста' : 'Translate text',
        },
      ].map(({ to, label }) => (
        <Link
          key={to}
          to={fromReader ? withReaderReturn(to) : to}
          aria-current={
            (to === '/vocabulary/text') ===
            (location.pathname === '/vocabulary/text')
              ? 'page'
              : undefined
          }
        >
          {to === '/vocabulary' ? (
            <AppIcon name="vocabulary" />
          ) : (
            <VocabularyIcon name="translate" />
          )}
          {label}
        </Link>
      ))}
    </nav>
  );
}
