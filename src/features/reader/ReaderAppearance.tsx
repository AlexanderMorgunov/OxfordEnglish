import { useId, useLayoutEffect, useRef } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { ReaderTextSize } from './ReaderTextSize';

export function ReaderAppearance({ open, onClose, returnFocus }: {
  open: boolean;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const ref = useRef<HTMLDialogElement>(null);
  const title = useId();
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) {
      dialog.close();
      returnFocus()?.focus({ preventScroll: true });
    }
  }, [open, returnFocus]);
  return <dialog ref={ref} aria-labelledby={title} onCancel={e => { e.preventDefault(); onClose(); }}
    onClick={e => {
      if (e.target !== e.currentTarget) return;
      const r = e.currentTarget.getBoundingClientRect();
      if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) onClose();
    }}
    className="reader-appearance fixed inset-auto right-2 bottom-2 left-auto m-0 max-h-[70dvh] w-[22rem] max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-line bg-surface p-4 text-content shadow-xl sm:right-5 sm:bottom-5">
    <div className="mb-2 flex items-center justify-between gap-3">
      <h2 id={title} className="min-w-0 text-lg font-semibold [overflow-wrap:anywhere]">{ru ? 'Вид текста' : 'Text appearance'}</h2>
      <button type="button" aria-label={ru ? 'Закрыть' : 'Close'} onClick={onClose} className="min-h-11 min-w-11 rounded-sm text-xl text-muted hover:bg-surface-2">×</button>
    </div>
    <ReaderTextSize />
  </dialog>;
}
