import { useState, useSyncExternalStore } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button } from '@/shared/ui';
import {
  canInstall,
  isIOS,
  isStandalone,
  promptInstall,
  subscribeInstall,
} from './install';

const DISMISS_KEY = 'pwa.install.dismissed';

function useCanInstall(): boolean {
  return useSyncExternalStore(subscribeInstall, canInstall, () => false);
}

export function InstallPrompt() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const installable = useCanInstall();
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === '1'
  );

  if (dismissed || isStandalone()) return null;

  const ios = isIOS();
  if (!installable && !ios) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  return (
    <div className="border-b border-teal-dim/50 bg-teal-dim/10">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-5 py-2.5">
        <p className="text-sm text-pretty">
          <span aria-hidden className="mr-2">📲</span>
          {installable
            ? ru
              ? 'Установите приложение — работает офлайн, открывается с домашнего экрана.'
              : 'Install the app — works offline, opens from your home screen.'
            : ru
              ? 'Добавьте на экран «Домой»: кнопка «Поделиться» → «На экран „Домой“».'
              : 'Add to Home Screen: the Share button → “Add to Home Screen”.'}
        </p>
        <div className="flex shrink-0 items-center gap-3">
          {installable && (
            <Button size="sm" onClick={() => void promptInstall()}>
              {ru ? 'Установить' : 'Install'}
            </Button>
          )}
          <button
            type="button"
            onClick={dismiss}
            className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
          >
            {ru ? 'скрыть' : 'dismiss'}
          </button>
        </div>
      </div>
    </div>
  );
}
