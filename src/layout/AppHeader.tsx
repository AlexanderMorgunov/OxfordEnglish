import { useLayoutEffect, useRef, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { PixelImage } from '@/shared/ui';
import { NavMore } from './NavMore';

type NavItem = {
  to: string;
  en: string;
  ru: string;
  tour?: string;
  icon?: string;
};

const PRIMARY: NavItem[] = [
  { to: '/', en: 'today', ru: 'сегодня' },
  { to: '/grammar', en: 'grammar', ru: 'грамматика' },
  { to: '/review', en: 'review', ru: 'повторение', tour: 'nav-review' },
  { to: '/vocabulary', en: 'vocab', ru: 'словарь' },
  { to: '/library', en: 'library', ru: 'библиотека', tour: 'nav-library' },
];
const OPTIONAL: NavItem[] = [
  { to: '/progress', en: 'progress', ru: 'прогресс' },
  { to: '/settings', en: 'settings', ru: 'настройки' },
];
const SECONDARY: NavItem[] = [
  { to: '/pro', en: 'Pro', ru: 'Pro', icon: '/assets/pixel/ui/ai.png' },
  ...OPTIONAL,
  { to: '/feedback', en: 'feedback', ru: 'обратная связь' },
  { to: '/support', en: 'support', ru: 'поддержка' },
  { to: '/about', en: 'about', ru: 'о нас', icon: '/assets/pixel/mascot.png' },
  ...(import.meta.env.DEV ? [{ to: '/kitchen-sink', en: 'kit', ru: 'kit', icon: '/assets/pixel/nav/settings.png' }] : []),
];
const LINK = 'min-w-0 max-w-full rounded-sm px-2.5 py-1.5 font-mono text-xs transition-colors';
const iconFor = (item: NavItem) => item.icon ?? `/assets/pixel/nav/${item.en}.png`;

export function AppHeader() {
  const level = useLearner(s => s.level);
  const ru = useUiLang(s => s.lang) === 'ru';
  const barRef = useRef<HTMLDivElement>(null);
  const brandRef = useRef<HTMLAnchorElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const focusAfterResize = useRef<string | null>(null);
  const countRef = useRef(0);
  const [count, setCount] = useState(0);

  useLayoutEffect(() => {
    const bar = barRef.current;
    const brand = brandRef.current;
    const measure = measureRef.current;
    if (!bar || !brand || !measure) return;
    const fit = () => {
      const style = getComputedStyle(bar);
      const available = bar.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
        - brand.getBoundingClientRect().width - parseFloat(style.columnGap);
      const gap = parseFloat(getComputedStyle(measure).columnGap);
      const widths = Array.from(measure.children, el => el.getBoundingClientRect().width);
      // The invisible row has unwrapped labels, so the estimate is independent of current wrapping.
      let used = widths.slice(0, PRIMARY.length).reduce((sum, width) => sum + width, 0)
        + (widths.at(-1) ?? 0) + gap * PRIMARY.length;
      let next = 0;
      if (Number.isFinite(available) && widths.every(width => width > 0)) {
        for (const width of widths.slice(PRIMARY.length, -1)) {
          used += width + gap;
          if (used > available - 2) break;
          next++;
        }
      }
      if (next === countRef.current) return;
      const focused = document.activeElement;
      const to = focused instanceof HTMLAnchorElement && navRef.current?.contains(focused)
        ? focused.getAttribute('href') : null;
      const index = OPTIONAL.findIndex(item => item.to === to);
      if (index >= 0 && (index < next) !== (index < countRef.current)) focusAfterResize.current = to;
      countRef.current = next;
      setCount(next);
    };
    fit();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
    observer?.observe(bar);
    observer?.observe(brand);
    observer?.observe(measure);
    window.addEventListener('resize', fit);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', fit);
    };
  }, [ru, level]);

  useLayoutEffect(() => {
    const to = focusAfterResize.current;
    if (!to) return;
    const target = Array.from(navRef.current?.querySelectorAll('a') ?? []).find(a => a.getAttribute('href') === to)
      ?? navRef.current?.querySelector('button');
    target?.focus();
    focusAfterResize.current = null;
  }, [count]);

  const visible = [...PRIMARY, ...OPTIONAL.slice(0, count)];
  return <header className="relative z-40 border-b border-line bg-surface/60 backdrop-blur">
    <div ref={barRef} className="app-container flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <NavLink ref={brandRef} to="/" className="flex min-w-0 max-w-full flex-wrap items-baseline gap-2 [overflow-wrap:anywhere]">
        <span className="eyebrow">en/dev</span>
        <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-2xs text-teal"
          title={level ? ru ? 'ваш уровень (по тесту)' : 'your level (from placement)' : ru ? 'диапазон курса' : 'course range'}>
          {level ?? 'A1–B2'}
        </span>
      </NavLink>
      <nav ref={navRef} aria-label={ru ? 'Основная навигация' : 'Main navigation'} className="relative flex min-w-0 max-w-full flex-wrap items-center gap-1">
        {visible.map(item => <NavLink key={item.to} to={item.to} end={item.to === '/'} data-tour={item.tour}
          className={({ isActive }) => `${LINK} ${isActive ? 'bg-surface-2 text-teal' : 'text-muted hover:text-content'}`}>
          <span className="flex min-w-0 items-center gap-1.5 [overflow-wrap:anywhere]">
            <PixelImage src={iconFor(item)} alt="" className="h-4 w-4 shrink-0" />
            {ru ? item.ru : item.en}
          </span>
        </NavLink>)}
        <NavMore label={ru ? 'ещё' : 'more'} items={SECONDARY.filter(item => !visible.includes(item)).map(item => ({
          to: item.to, label: ru ? item.ru : item.en, icon: iconFor(item),
        }))} />
      </nav>
    </div>
    <div aria-hidden inert className="pointer-events-none invisible fixed inset-0 overflow-hidden">
      <div ref={measureRef} className="flex w-max items-center gap-1">
        {[...PRIMARY, ...OPTIONAL].map(item => <span key={item.to} className={LINK}>
          <span className="flex items-center gap-1.5 whitespace-nowrap"><span className="w-4 shrink-0" />{ru ? item.ru : item.en}</span>
        </span>)}
        <span className={`${LINK} flex items-center gap-1.5 whitespace-nowrap`}><span className="w-4 shrink-0" />{ru ? 'ещё' : 'more'}</span>
      </div>
    </div>
  </header>;
}
