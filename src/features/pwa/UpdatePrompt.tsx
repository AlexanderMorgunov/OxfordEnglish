import { useSyncExternalStore } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { subscribeAppUpdate, isUpdateReady, applyAppUpdate } from './update';

/** A slim banner shown when a newer app version is waiting; applying it reloads into the update. */
export function UpdatePrompt() {
  const ready = useSyncExternalStore(subscribeAppUpdate, isUpdateReady, () => false);
  const ru = useUiLang((s) => s.lang) === 'ru';
  if (!ready) return null;
  return (
    <div
      role="status"
      className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-2.5"
    >
      <div className="flex items-center gap-2 rounded-md border border-teal-dim bg-teal-dim/10 px-3.5 py-2 text-sm">
        <span className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
          {ru ? 'обновление' : 'update'}
        </span>
        <span>{ru ? 'Доступна новая версия приложения.' : 'A new version is available.'}</span>
        <button
          type="button"
          onClick={() => void applyAppUpdate()}
          className="ml-1 rounded-sm bg-teal px-2.5 py-1 font-mono text-2xs font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {ru ? 'Обновить' : 'Update'}
        </button>
      </div>
    </div>
  );
}
