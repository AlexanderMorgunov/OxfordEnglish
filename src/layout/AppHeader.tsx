import { useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import mark from '@/assets/brand/dayenglish-mark.svg';
import { NAVIGATION_INSETS_EVENT } from '@/shared/lib/navigation-insets';
import { NavMore } from './NavMore';
import { NavigationLink } from './NavigationLink';
import { focusNavigationControl } from './navigation-focus';
import {
  PRIMARY,
  SECONDARY,
  navigationContext,
  navigationLayout,
} from './navigation';
import type { NavigationLayout } from './navigation';
import './navigation.css';

function Brand() {
  return (
    <span className="app-brand-content">
      <img src={mark} width={44} height={44} alt="" />
      <span className="app-wordmark">
        Day
        <wbr />
        English
      </span>
    </span>
  );
}

export function AppHeader() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  const current = navigationContext(location.pathname, location.search);
  const [layout, setLayout] = useState<NavigationLayout>('stacked');
  const layoutRef = useRef(layout);
  const header = useRef<HTMLElement>(null);
  const bar = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const pendingFocus = useRef<string | null>(null);

  useLayoutEffect(() => {
    const container = bar.current,
      probes = measure.current;
    if (!container || !probes) return;
    let frame = 0;
    let alive = true;
    const publish = () => {
      const top =
        layoutRef.current === 'stacked'
          ? 0
          : Math.ceil(header.current?.getBoundingClientRect().height ?? 0);
      const low = Math.ceil(
        bottom.current?.getBoundingClientRect().height ?? 0
      );
      const style = document.documentElement.style;
      const values = [
        ['--app-nav-top', top],
        ['--app-nav-bottom', low],
      ] as const;
      let changed = false;
      for (const [name, value] of values)
        if (style.getPropertyValue(name) !== `${value}px`) {
          style.setProperty(name, `${value}px`);
          changed = true;
        }
      if (changed) window.dispatchEvent(new Event(NAVIGATION_INSETS_EVENT));
    };
    const fit = () => {
      frame = 0;
      if (!alive) return;
      const style = getComputedStyle(container);
      const available =
        container.clientWidth -
        (parseFloat(style.paddingLeft) || 0) -
        (parseFloat(style.paddingRight) || 0);
      const width = document.documentElement.clientWidth || innerWidth;
      const sizes = Array.from(
        probes.children,
        (e) => e.getBoundingClientRect().width
      );
      const next = navigationLayout({
        width,
        height: window.visualViewport?.height ?? innerHeight,
        available,
        required: (sizes[0] ?? 0) + (sizes[1] ?? 0) + (sizes[2] ?? 0) + 48,
        labelWidth: sizes[3] ?? 0,
      });
      if (next !== layoutRef.current) {
        const focused = document.activeElement;
        if (
          focused instanceof HTMLElement &&
          (header.current?.contains(focused) ||
            bottom.current?.contains(focused))
        )
          pendingFocus.current =
            focused.closest<HTMLElement>('[data-nav-destination]')?.dataset
              .navDestination ?? 'trigger';
        layoutRef.current = next;
        setLayout(next);
      }
      publish();
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(fit);
    };
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(container);
    observer?.observe(probes);
    for (const probe of probes.children) observer?.observe(probe);
    if (header.current) observer?.observe(header.current);
    if (bottom.current) observer?.observe(bottom.current);
    fit();
    window.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('resize', schedule);
    document.fonts?.addEventListener('loadingdone', schedule);
    void document.fonts?.ready.then(() => {
      if (alive) schedule();
    });
    return () => {
      alive = false;
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('resize', schedule);
      document.fonts?.removeEventListener('loadingdone', schedule);
    };
  }, [ru, layout]);

  useLayoutEffect(() => {
    const to = pendingFocus.current;
    if (!to) return;
    const links = [
      ...(header.current?.querySelectorAll<HTMLElement>(
        '[data-nav-destination]'
      ) ?? []),
      ...(bottom.current?.querySelectorAll<HTMLElement>(
        '[data-nav-destination]'
      ) ?? []),
    ];
    const target =
      links.find((e) => e.dataset.navDestination === to) ??
      header.current?.querySelector<HTMLElement>('[data-nav-trigger]');
    focusNavigationControl(target);
    pendingFocus.current = null;
  }, [layout]);

  const progress = SECONDARY[0]!;
  const settings = SECONDARY[1]!;
  const wide = layout === 'wide';
  const items = SECONDARY.filter(
    (item) => !wide || (item.to !== progress.to && item.to !== settings.to)
  );
  return (
    <>
      <header ref={header} className="app-header" data-nav-layout={layout}>
        <div ref={bar} className="app-container app-nav-top">
          <Link
            to="/"
            className="app-brand"
            data-nav-destination="brand"
            aria-label={ru ? 'DayEnglish · Сегодня' : 'DayEnglish · Today'}
          >
            <Brand />
          </Link>
          {wide && (
            <nav
              className="app-nav-primary"
              aria-label={ru ? 'Основная навигация' : 'Main navigation'}
            >
              {[...PRIMARY, progress].map((item) => (
                <NavigationLink
                  key={item.to}
                  item={item}
                  ru={ru}
                  current={current}
                />
              ))}
            </nav>
          )}
          <div className="app-nav-utilities">
            {wide && (
              <Link
                to={settings.to}
                className="app-nav-settings"
                data-nav-destination={settings.to}
                aria-label={ru ? settings.ru : settings.en}
                title={ru ? settings.ru : settings.en}
                aria-current={current === settings.to ? 'page' : undefined}
              >
                <AppIcon name="settings" />
              </Link>
            )}
            <NavMore
              key={layout}
              items={items}
              primary={layout === 'stacked' ? PRIMARY : []}
              layout={layout}
              current={current}
              ru={ru}
            />
          </div>
        </div>
      </header>
      {layout === 'bottom' && (
        <nav
          ref={bottom}
          className="app-nav-bottom"
          aria-label={ru ? 'Основная навигация' : 'Main navigation'}
        >
          {PRIMARY.map((item) => (
            <NavigationLink
              key={item.to}
              item={item}
              ru={ru}
              current={current}
            />
          ))}
        </nav>
      )}
      <div ref={measure} className="app-nav-measure" aria-hidden="true" inert>
        <span className="app-brand">
          <Brand />
        </span>
        <div className="app-nav-primary">
          {[...PRIMARY, progress].map((item) => (
            <span className="app-nav-probe-link" key={item.to}>
              <AppIcon name={item.icon} />
              <span>{ru ? item.ru : item.en}</span>
            </span>
          ))}
        </div>
        <div className="app-nav-utilities">
          <span className="app-nav-settings">
            <AppIcon name="settings" />
          </span>
          <span className="app-nav-more">
            <AppIcon name="more" />
            <span>{ru ? 'Ещё' : 'More'}</span>
          </span>
        </div>
        <span className="app-nav-label-probe">
          {PRIMARY.map((item) => (
            <span key={item.to}>{ru ? item.ru : item.en}</span>
          ))}
        </span>
      </div>
    </>
  );
}
