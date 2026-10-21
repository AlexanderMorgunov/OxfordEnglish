import { NavLink, useSearchParams } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { PixelImage } from '@/shared/ui';
import { withReaderReturn } from '@/features/reader/return-to-reader';

export function VocabularyNav() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  return <nav aria-label={ru ? 'Разделы словаря' : 'Vocabulary sections'} className="mb-5 grid gap-2 sm:flex sm:flex-wrap"
    style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, calc(8.5rem * var(--app-text-scale, 1))), 1fr))' }}>
    {[{ to: '/vocabulary', icon: '/assets/pixel/nav/vocab.png', label: ru ? 'Мой словарь' : 'My vocabulary' },
      { to: '/vocabulary/text', icon: '/assets/pixel/ui/translate.png', label: ru ? 'Перевод текста' : 'Translate text' }].map(({ to, icon, label }) =>
      <NavLink key={to} to={fromReader ? withReaderReturn(to) : to} end className={({ isActive }) =>
        `inline-flex min-h-11 min-w-0 items-center gap-2 rounded-sm border px-2.5 py-2 text-sm ${isActive ? 'border-teal-dim bg-surface-2 text-teal' : 'border-line text-muted hover:text-content'}`}>
        <PixelImage src={icon} alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6 shrink-0" />
        {label}
      </NavLink>)}
  </nav>;
}
