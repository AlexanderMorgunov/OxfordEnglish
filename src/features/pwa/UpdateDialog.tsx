import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  subscribeAppUpdate,
  isUpdateModalOpen,
  applyAppUpdate,
  dismissUpdateModal,
} from './update';

/** Launch-time update prompt: a native <dialog> (free focus trap, Escape, backdrop, aria-modal,
 *  focus restore). Shown only when an update is found before the user engages with the app. */
export function UpdateDialog() {
  const open = useSyncExternalStore(subscribeAppUpdate, isUpdateModalOpen, () => false);
  const ru = useUiLang((s) => s.lang) === 'ru';
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // showModal() throws on an already-open dialog; the effect double-runs under StrictMode.
    if (open && !d.open) d.showModal();
    else if (!open && d.open) d.close();
  }, [open]);

  // Any close (button, Escape, backdrop) records the dismissal so a background re-check can't
  // reopen the modal this session; the banner takes over as the fallback.
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onClose = () => dismissUpdateModal();
    d.addEventListener('close', onClose);
    return () => d.removeEventListener('close', onClose);
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="app-update-title"
      className="m-auto w-[min(92vw,26rem)] rounded-lg border border-line bg-surface p-6 text-content shadow-[0_10px_40px_rgba(0,0,0,0.5)] backdrop:bg-ink/70"
    >
      <p className="eyebrow mb-2">{ru ? 'обновление' : 'update'}</p>
      <h2 id="app-update-title" className="mb-2 text-xl font-bold tracking-tight">
        {ru ? 'Доступна новая версия' : 'A new version is available'}
      </h2>
      <p className="mb-5 text-sm text-muted text-pretty">
        {ru
          ? 'Обновиться сейчас? Приложение перезагрузится — это займёт секунду.'
          : 'Update now? The app will reload — it takes a second.'}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          className="rounded-sm px-3.5 py-2 font-mono text-sm text-muted transition-colors hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {ru ? 'Позже' : 'Later'}
        </button>
        <button
          type="button"
          autoFocus
          onClick={() => void applyAppUpdate()}
          className="rounded-sm bg-teal px-4 py-2 font-mono text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {ru ? 'Обновить' : 'Update'}
        </button>
      </div>
    </dialog>
  );
}
