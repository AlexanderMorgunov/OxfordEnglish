import { useLayoutEffect, useRef } from 'react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';

export function ReplaceTranslationDialog({ continuing, onConfirm, onClose, returnFocus }: {
  continuing: boolean;
  onConfirm: () => void;
  onClose: () => void;
  returnFocus: HTMLElement | null;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const ref = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    return () => {
      dialog.close?.();
      if (returnFocus?.isConnected && returnFocus.getClientRects().length) returnFocus.focus({ preventScroll: true });
    };
  }, [returnFocus]);
  return <dialog ref={ref} aria-labelledby="replace-translation-title" aria-describedby="replace-translation-description"
    onCancel={event => { event.preventDefault(); onClose(); }}
    className="m-auto max-h-[85dvh] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-md border border-line bg-surface p-5 text-content backdrop:bg-black/60">
    <div className="flex items-start justify-between gap-3">
      <h2 id="replace-translation-title" className="text-lg font-semibold">{continuing
        ? ru ? 'Продолжить без ручных правок?' : 'Continue without your edits?'
        : ru ? 'Заменить ручные правки?' : 'Replace your edits?'}</h2>
      <button type="button" onClick={onClose} aria-label={ru ? 'Закрыть предупреждение' : 'Close warning'} className="min-h-11 min-w-11 rounded-sm text-xl text-muted hover:bg-surface-2">×</button>
    </div>
    <p id="replace-translation-description" className="mt-3 text-sm leading-relaxed text-muted">{continuing
      ? ru ? 'Сохраним полученные фрагменты без ваших правок и переведём оставшиеся. Можно оставить исправленный текст.' : 'We will keep completed segments without your edits and translate the rest. You can keep your edited text instead.'
      : ru ? 'Новый перевод заменит исправленный вами русский текст. Исходник и правки останутся, если отменить.' : 'A new translation will replace the Russian text you edited. Cancel to keep your source and edits.'}</p>
    <div className="mt-5 flex flex-wrap justify-end gap-2">
      <Button variant="ghost" autoFocus onClick={onClose} className="min-h-11">{ru ? 'Оставить правки' : 'Keep edits'}</Button>
      <Button onClick={onConfirm} className="min-h-11">{continuing
        ? ru ? 'Заменить и продолжить' : 'Replace and continue'
        : ru ? 'Заменить и перевести' : 'Replace and translate'}</Button>
    </div>
  </dialog>;
}
