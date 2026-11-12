import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import mark from '@/assets/brand/dayenglish-mark.svg';
import { installEnvironment } from './environment';
import {
  androidInstallPending,
  hideAndroidInstall,
  RUSTORE_URL,
  subscribeAndroidInstall,
} from './memory';
import './android-install.css';

export function AndroidInstallOffer({ ready }: { ready: boolean }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const pending = useSyncExternalStore(
    subscribeAndroidInstall,
    androidInstallPending
  );
  const [safe, setSafe] = useState(false);
  const [notice, setNotice] = useState('');
  const status = useRef<HTMLParagraphElement>(null);
  useLayoutEffect(() => {
    if (!ready || !pending) return;
    const check = () =>
      setSafe(
        !document.hidden &&
          installEnvironment() === 'android' &&
          !document.querySelector(
            'dialog[open], [role="dialog"], [data-welcome-pending="true"], .ct-popover, .pro-sale-banner, .fw-pending, .account-access-notice, [data-install-blocker], .app-nav-panel'
          )
      );
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open', 'hidden', 'class', 'data-welcome-pending'],
    });
    document.addEventListener('visibilitychange', check);
    window.addEventListener('resize', check);
    check();
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('resize', check);
    };
  }, [ready, pending]);
  const leave = (reason: 'dismissed' | 'store') => {
    const saved = hideAndroidInstall(reason);
    setNotice(
      saved
        ? ru
          ? 'Ссылка на приложение остаётся в меню «Ещё» и внизу страницы.'
          : 'The app link is still in More and the footer.'
        : ru
          ? 'Предложение скрыто на время этой вкладки. Браузер не разрешил запомнить выбор; после перезагрузки оно может появиться снова.'
          : 'Hidden for this tab. Your browser could not save this choice; the offer may return after a reload.'
    );
    status.current?.focus({ preventScroll: true });
  };
  return (
    <>
      {ready && pending && safe && (
        <aside className="android-offer" aria-labelledby="android-offer-title">
          <img src={mark} width="48" height="48" alt="" />
          <div className="android-offer-copy">
            <p className="android-eyebrow">
              {ru ? 'Теперь и для Android' : 'Also on Android'}
            </p>
            <h2 id="android-offer-title">
              {ru
                ? 'Ваш английский. В одном касании.'
                : 'Your English. One tap away.'}
            </h2>
            <p>
              {ru
                ? 'Открывайте DayEnglish с экрана телефона — без поиска нужной вкладки.'
                : 'Open DayEnglish from your home screen, without searching for a browser tab.'}
            </p>
            <Link to="/android">
              {ru
                ? 'Об установке и переносе прогресса'
                : 'Installation and moving your progress'}{' '}
              →
            </Link>
          </div>
          <div className="android-offer-actions">
            <a
              className="android-primary"
              href={RUSTORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => leave('store')}
            >
              {ru ? 'Открыть RuStore' : 'Open RuStore'}{' '}
              <AppIcon name="external" />
              <span className="sr-only">
                {ru ? ' — новая вкладка' : ' — new tab'}
              </span>
            </a>
            <button type="button" onClick={() => leave('dismissed')}>
              {ru ? 'Не сейчас' : 'Not now'}
            </button>
          </div>
        </aside>
      )}
      <p
        ref={status}
        tabIndex={-1}
        role="status"
        className={notice ? 'android-offer-notice' : 'sr-only'}
      >
        {notice}
      </p>
    </>
  );
}
