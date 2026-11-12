import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { AppIcon } from '@/shared/ui/AppIcon';
import { SOCIAL_CHANNELS } from '@/features/community/channels';
import { SocialLink } from '@/features/community/SocialLink';
import { NavigationLink } from './NavigationLink';
import { focusNavigationControl } from './navigation-focus';
import type { NavDestination, NavigationLayout } from './navigation';

export function NavMore({
  items,
  primary,
  layout,
  current,
  ru,
}: {
  items: NavDestination[];
  primary: NavDestination[];
  layout: NavigationLayout;
  current: string | null;
  ru: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    panel = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const location = useLocation();
  const active =
    current === '/android'
      ? { ru: 'Android', en: 'Android' }
      : [...primary, ...items].find((item) => item.to === current);
  const label =
    layout === 'stacked' ? (ru ? 'Разделы' : 'Sections') : ru ? 'Ещё' : 'More';
  const subtitle = active ? (ru ? active.ru : active.en) : '';
  const close = (restore = false) => {
    setOpen(false);
    if (restore) focusNavigationControl(button.current);
  };
  useLayoutEffect(() => {
    if (panel.current?.contains(document.activeElement))
      focusNavigationControl(button.current);
    setOpen(false);
  }, [location.key]);
  useLayoutEffect(() => {
    if (!open) return;
    const trigger = button.current,
      box = panel.current;
    if (!trigger || !box) return;
    const position = () => {
      const bounds = trigger.getBoundingClientRect(),
        vp = window.visualViewport;
      const left = vp?.offsetLeft ?? 0,
        top = vp?.offsetTop ?? 0,
        width =
          vp?.width ?? (document.documentElement.clientWidth || innerWidth),
        height = vp?.height ?? innerHeight;
      const bottom =
        document.querySelector('.app-nav-bottom')?.getBoundingClientRect()
          .height ?? 0;
      box.style.maxWidth = `${Math.max(0, width - 16)}px`;
      const y = Math.max(
        top + 8,
        Math.min(bounds.bottom + 8, top + height - 88 - bottom)
      );
      box.style.top = `${Math.round(y)}px`;
      box.style.maxHeight = `${Math.max(0, top + height - y - 8 - bottom)}px`;
      const x = Math.max(
        left + 8,
        Math.min(
          bounds.right - box.offsetWidth,
          left + width - box.offsetWidth - 8
        )
      );
      box.style.left = `${Math.round(x)}px`;
    };
    position();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(position);
    observer?.observe(box);
    if (root.current) observer?.observe(root.current);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, {
      passive: true,
      capture: true,
    });
    window.visualViewport?.addEventListener('resize', position);
    window.visualViewport?.addEventListener('scroll', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      window.visualViewport?.removeEventListener('resize', position);
      window.visualViewport?.removeEventListener('scroll', position);
    };
  }, [open, layout, subtitle]);
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
        focusNavigationControl(button.current);
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return (
    <div
      ref={root}
      className="app-nav-more-root"
      onBlur={(event) => {
        if (
          event.relatedTarget &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          setOpen(false);
      }}
    >
      <button
        ref={button}
        type="button"
        data-nav-trigger
        data-tour={layout === 'stacked' ? 'nav-sections' : undefined}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`${label}${subtitle ? ' · ' + subtitle : ''}`}
        className={`app-nav-more${active ? ' is-current' : ''}`}
        onClick={() => setOpen((v) => !v)}
      >
        <AppIcon name={layout === 'stacked' ? 'sections' : 'more'} />
        <span>
          {label}
          {subtitle && <small>{subtitle}</small>}
        </span>
        {active && <i className="app-nav-context-dot" aria-hidden="true" />}
      </button>
      {open && (
        <div ref={panel} id={panelId} className="app-nav-panel">
          <div className="app-nav-panel-head">
            <h2>
              {layout === 'stacked'
                ? ru
                  ? 'Разделы DayEnglish'
                  : 'DayEnglish sections'
                : ru
                  ? 'Ещё в DayEnglish'
                  : 'More in DayEnglish'}
            </h2>
            <button
              type="button"
              onClick={() => close(true)}
              aria-label={ru ? 'Закрыть навигацию' : 'Close navigation'}
            >
              <AppIcon name="close" />
            </button>
          </div>
          {!!primary.length && (
            <nav
              className="app-nav-panel-links"
              aria-label={ru ? 'Основная навигация' : 'Main navigation'}
            >
              {primary.map((item) => (
                <NavigationLink
                  key={item.to}
                  item={item}
                  ru={ru}
                  current={current}
                  onClick={() => close()}
                />
              ))}
            </nav>
          )}
          <nav
            className="app-nav-panel-links"
            aria-label={ru ? 'Дополнительные разделы' : 'Additional sections'}
          >
            {items.map((item) => (
              <NavigationLink
                key={item.to}
                item={item}
                ru={ru}
                current={current}
                onClick={() => close()}
              />
            ))}
          </nav>
          <nav
            className="app-nav-panel-links"
            aria-label={ru ? 'Приложение' : 'App'}
          >
            <Link
              to="/android"
              onClick={() => close()}
              aria-current={
                location.pathname === '/android' ? 'page' : undefined
              }
            >
              <AppIcon name="phone" />
              <span>{ru ? 'Приложение для Android' : 'Android app'}</span>
            </Link>
          </nav>
          <nav
            className="app-nav-panel-links app-nav-social"
            aria-label={
              ru ? 'DayEnglish в соцсетях' : 'DayEnglish on social media'
            }
          >
            <p>{ru ? 'DayEnglish в соцсетях' : 'DayEnglish on social media'}</p>
            {SOCIAL_CHANNELS.map((channel) => (
              <SocialLink
                key={channel.id}
                channel={channel}
                onClick={() => close(true)}
              />
            ))}
            <Link to="/about#community" onClick={() => close()}>
              <span>{ru ? 'Что публикуем' : 'What we share'}</span>
              <span aria-hidden="true">→</span>
            </Link>
          </nav>
          <p className="app-nav-panel-note">
            {ru
              ? 'Английский день за днём · курс A1–B2'
              : 'English, day by day · A1–B2 course'}
          </p>
        </div>
      )}
    </div>
  );
}
