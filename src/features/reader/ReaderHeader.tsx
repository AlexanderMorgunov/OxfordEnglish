import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { NAVIGATION_INSETS_EVENT } from '@/shared/lib/navigation-insets';
import mark from '@/assets/brand/dayenglish-mark.svg';
import { ReaderIcon } from './ReaderIcon';
import { OnboardingHelp } from '@/features/onboarding/OnboardingHelp';
import type { ReaderIconName } from './ReaderIcon';

export function ReaderHeader({
  title,
  chapter,
  total,
  libraryReturn,
  bookmarkCount,
  onContents,
  onBookmarks,
  onAppearance,
  onSections,
}: {
  title: string;
  chapter: number;
  total: number;
  libraryReturn: string;
  bookmarkCount: number | null;
  onContents: () => void;
  onBookmarks: () => void;
  onAppearance: () => void;
  onSections: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const root = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const measure = () => {
      document.documentElement.style.setProperty(
        '--reader-header-height',
        `${Math.ceil(root.current?.getBoundingClientRect().height ?? 0)}px`
      );
      window.dispatchEvent(new Event(NAVIGATION_INSETS_EVENT));
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(measure);
    if (root.current) observer?.observe(root.current);
    window.addEventListener('resize', measure);
    measure();
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      document.documentElement.style.removeProperty('--reader-header-height');
      window.dispatchEvent(new Event(NAVIGATION_INSETS_EVENT));
    };
  }, []);
  const tools: {
    icon: ReaderIconName;
    label: string;
    action: () => void;
    count?: number | null;
  }[] = [
    {
      icon: 'contents',
      label: ru ? 'Содержание' : 'Contents',
      action: onContents,
    },
    {
      icon: 'bookmark',
      label: ru ? 'Закладки' : 'Bookmarks',
      action: onBookmarks,
      count: bookmarkCount,
    },
    {
      icon: 'type',
      label: ru ? 'Вид текста' : 'Text appearance',
      action: onAppearance,
    },
    { icon: 'grid', label: ru ? 'Разделы' : 'Sections', action: onSections },
  ];
  return (
    <header ref={root} className="rd-reader-header">
      <div className="rd-reader-topbar">
        <Link
          to={libraryReturn}
          className="rd-back-library"
          aria-label={ru ? 'К библиотеке' : 'Back to library'}
        >
          <ReaderIcon name="back" />
          <span>{ru ? 'Библиотека' : 'Library'}</span>
        </Link>
        <Link to="/" className="rd-reader-brand" aria-label="DayEnglish">
          <img src={mark} width={36} height={36} alt="" />
        </Link>
        <div className="rd-book-ident">
          <strong title={title}>{title}</strong>
          <small>
            {ru
              ? `Глава ${chapter + 1} из ${total}`
              : `Chapter ${chapter + 1} of ${total}`}
          </small>
        </div>
        <nav
          className="rd-reader-tools"
          aria-label={ru ? 'Действия с книгой' : 'Book actions'}
        >
          {tools.map((tool) => (
            <button
              type="button"
              key={tool.icon}
              className="rd-tool"
              title={tool.label}
              aria-label={tool.label}
              aria-haspopup="dialog"
              data-onboarding={tool.icon === 'type' ? 'reader-appearance' : undefined}
              onClick={tool.action}
            >
              <ReaderIcon name={tool.icon} />
              <span>{tool.label}</span>
              {tool.count != null && <b>{tool.count}</b>}
            </button>
          ))}
          <OnboardingHelp reader />
        </nav>
      </div>
    </header>
  );
}
