import type { AppIconName } from '@/shared/ui/AppIcon';

export type NavDestination = {
  to: string;
  ru: string;
  en: string;
  icon: AppIconName;
  tour?: string;
};
export type NavigationLayout = 'wide' | 'bottom' | 'stacked';
export const PRIMARY: NavDestination[] = [
  { to: '/', ru: 'Сегодня', en: 'Today', icon: 'today' },
  { to: '/grammar', ru: 'Грамматика', en: 'Grammar', icon: 'grammar' },
  {
    to: '/review',
    ru: 'Повторение',
    en: 'Review',
    icon: 'review',
    tour: 'nav-review',
  },
  { to: '/vocabulary', ru: 'Словарь', en: 'Vocabulary', icon: 'vocabulary' },
  {
    to: '/library',
    ru: 'Библиотека',
    en: 'Library',
    icon: 'library',
    tour: 'nav-library',
  },
];
export const SECONDARY: NavDestination[] = [
  { to: '/progress', ru: 'Прогресс', en: 'Progress', icon: 'progress' },
  { to: '/settings', ru: 'Настройки', en: 'Settings', icon: 'settings' },
  { to: '/pro', ru: 'DayEnglish Pro', en: 'DayEnglish Pro', icon: 'pro' },
  { to: '/feedback', ru: 'Обратная связь', en: 'Feedback', icon: 'feedback' },
  { to: '/support', ru: 'Поддержка', en: 'Support', icon: 'support' },
  { to: '/about', ru: 'О DayEnglish', en: 'About DayEnglish', icon: 'about' },
  ...(import.meta.env.DEV
    ? [
        {
          to: '/kitchen-sink',
          ru: 'UI-kit',
          en: 'UI kit',
          icon: 'sections' as const,
        },
      ]
    : []),
];
export function navigationContext(
  pathname: string,
  search = ''
): string | null {
  if (
    pathname === '/' ||
    pathname === '/syllabus' ||
    pathname === '/placement' ||
    pathname.startsWith('/course/')
  )
    return '/';
  if (pathname.startsWith('/checkpoint/'))
    return new URLSearchParams(search).get('from') === 'progress'
      ? '/progress'
      : '/';
  if (pathname.startsWith('/billing/')) return '/pro';
  if (pathname === '/credits') return '/about';
  return (
    [...PRIMARY, ...SECONDARY].find(
      (item) =>
        item.to !== '/' &&
        (pathname === item.to || pathname.startsWith(`${item.to}/`))
    )?.to ?? null
  );
}
export function navigationLayout({
  width,
  height,
  available,
  required,
  labelWidth,
}: {
  width: number;
  height: number;
  available: number;
  required: number;
  labelWidth: number;
}): NavigationLayout {
  if (width >= 1100 && height >= 400 && required <= available) return 'wide';
  return height < 400 || labelWidth + 2 > (width - 24) / 5
    ? 'stacked'
    : 'bottom';
}
