import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '@/db/db';
import { captureDataScope } from '@/features/account/dataScope';
import { isDeleted } from '@/features/sync/resolve';
import { useUiLang } from '@/features/i18n/uiLang';
import { cancelAudioInput } from '@/shared/lib/audio-input';
import { Button, Input, PixelImage } from '@/shared/ui';
import { RussianTermSchema, translateRussianTerm } from './russian-entry';
import type { RussianProposal } from './russian-entry';

export function RussianTermInput({ disabled, draftRevision, onChoose }: {
  disabled: boolean; draftRevision: number; onChoose: (proposal: RussianProposal) => void;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const [source, setSource] = useState('');
  const [result, setResult] = useState<RussianProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const selectionLock = useRef(false);
  const revision = useRef(draftRevision);
  const requestButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const useButton = useRef<HTMLButtonElement>(null);
  const focusAfterRequest = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  useLayoutEffect(() => { if (panel.current) panel.current.open = true; }, []);
  useEffect(() => {
    if (busy) cancelButton.current?.focus();
    else if (focusAfterRequest.current) {
      focusAfterRequest.current = false;
      if (panel.current?.open) (result ? useButton : requestButton).current?.focus();
    }
  }, [busy, result]);
  const cancel = useCallback(() => { generation.current++; controller.current?.abort(); controller.current = null; }, []);
  useLayoutEffect(() => { revision.current = draftRevision; cancel(); setBusy(false); }, [draftRevision, cancel]);
  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => { if (disabled) { cancel(); setBusy(false); } }, [disabled, cancel]);
  const request = async () => {
    if (disabled || controller.current || !panel.current?.open || !RussianTermSchema.safeParse(source).success) return;
    cancel();
    const id = generation.current;
    const current = captureDataScope();
    const own = new AbortController(); controller.current = own;
    setBusy(true); setResult(null); setError(''); setNotice('');
    try {
      const proposal = await translateRussianTerm(source, own.signal);
      if (current() && id === generation.current && !own.signal.aborted && panel.current?.open) {
        focusAfterRequest.current = document.activeElement === cancelButton.current;
        setResult(proposal); setNotice(ru ? 'Перевод готов. Проверьте английский вариант.' : 'Translation ready. Check the English term.');
      }
    } catch {
      if (current() && id === generation.current && !own.signal.aborted) {
        focusAfterRequest.current = document.activeElement === cancelButton.current;
        setError(ru ? 'Перевод недоступен. Уточните исходное слово, попробуйте позже или заполните английский вариант вручную.' : 'Translation unavailable. Refine the Russian text, try later or enter the English term manually.');
      }
    } finally {
      if (current() && id === generation.current) { cancel(); setBusy(false); }
    }
  };
  const choose = async () => {
    if (!result || disabled || selectionLock.current) return;
    selectionLock.current = true;
    const current = captureDataScope(); const id = generation.current; const expected = revision.current;
    try {
      const kind = /\s/.test(result.english) ? 'phrase' : 'word';
      const card = await db.srsCards.get(`${kind}:${result.english.toLowerCase()}`);
      if (!current() || id !== generation.current || expected !== revision.current || !panel.current?.open) return;
      if (card) {
        setError(isDeleted(card) ? ru ? 'Это английское слово ранее удалено. Новая карточка не создаётся.' : 'This English term was previously deleted. A new card will not be created.' : ru ? 'У этого английского слова уже есть карточка. Изменить её перевод можно в словаре ниже.' : 'This English term already has a card. You can edit its translation in the vocabulary below.');
        return;
      }
      onChoose(result); setError('');
      setNotice(ru ? 'Перевод перенесён в черновик. Проверьте значение и поля перед добавлением.' : 'Translation copied to the draft. Check its meaning and the fields before adding.');
      if (panel.current) panel.current.open = false;
    } catch {
      if (current() && id === generation.current) setError(ru ? 'Не удалось проверить карточку. Попробуйте ещё раз.' : 'Could not check the card. Try again.');
    } finally { selectionLock.current = false; }
  };
  return <div className="min-w-0">
    <details ref={panel} className="rounded-md border border-line bg-ink p-3" onToggle={event => {
      if (event.currentTarget.open) return;
      cancel(); setBusy(false);
      if (event.currentTarget.contains(document.activeElement)) summary.current?.focus();
    }}>
      <summary ref={summary} className="min-h-11 cursor-pointer text-sm font-semibold text-content" onClick={() => {
        if (panel.current?.open) {
          cancel(); setBusy(false);
          if (busy) setNotice(ru ? 'Запрос отменён.' : 'Request cancelled.');
        }
      }}>
        <span className="inline-flex items-center gap-2 align-middle"><PixelImage src="/assets/pixel/ui/translate.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8 shrink-0" />{ru ? 'Найти английский вариант' : 'Find the English term'}</span>
      </summary>
      <div className="mt-3">
        <label htmlFor="russian-source" className="text-sm text-muted">{ru ? 'Исходное слово или фраза на русском' : 'Russian source word or phrase'}</label>
        <Input id="russian-source" lang="ru" className="mt-2" value={source} disabled={disabled} placeholder={ru ? 'например, репчатый лук' : 'e.g. репчатый лук'} onKeyDown={e => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); void request(); }
        }} onChange={e => {
          cancelAudioInput(); cancel(); setBusy(false); setSource(e.target.value); setResult(null); setError(''); setNotice('');
        }} />
        <div className="mt-2 flex flex-wrap gap-2">
          <Button ref={requestButton} variant="ghost" className="min-h-11" disabled={disabled || busy || !RussianTermSchema.safeParse(source).success} onClick={() => void request()}>
            {busy ? ru ? 'Переводим…' : 'Translating…' : ru ? 'Перевести на английский' : 'Translate to English'}
          </Button>
          {busy && <Button ref={cancelButton} variant="ghost" className="min-h-11" onClick={() => {
            cancel(); setBusy(false); setNotice(ru ? 'Запрос отменён.' : 'Request cancelled.');
            requestAnimationFrame(() => { if (requestButton.current?.isConnected) requestButton.current.focus(); });
          }}>{ru ? 'Отменить перевод' : 'Cancel translation'}</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">{ru ? 'Бесплатно · MyMemory · без AI-квоты. Текст отправится сервису после нажатия. Для точного значения уточните слово.' : 'Free · MyMemory · no AI quota. Text is sent after you press Translate. Refine the source for the intended meaning.'}</p>
        {!!source && !RussianTermSchema.safeParse(source).success && <p className="mt-1 text-xs text-muted">{ru ? 'Введите короткое слово или фразу на русском — до 80 символов, без переноса строк.' : 'Enter a short Russian word or phrase, up to 80 characters, without line breaks.'}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}
        {result && <div className="mt-3 rounded-md border border-line bg-surface p-3 [overflow-wrap:anywhere]">
          <p className="text-xs text-muted">{ru ? 'Предложенный перевод · MyMemory' : 'Suggested translation · MyMemory'}{result.cached ? ru ? ' · из кеша' : ' · cached' : ''}</p>
          <p lang="en" className="my-2 font-semibold text-content">{result.english}</p>
          <Button ref={useButton} variant="ghost" className="min-h-11" disabled={disabled} onClick={() => void choose()}>{ru ? 'Использовать перевод в полях ниже' : 'Use translation in the fields below'}</Button>
          <p className="mt-2 text-xs text-muted">{ru ? 'Заменит английское слово и русский перевод в черновике. Пример останется; проверьте его соответствие. Карточка ещё не сохраняется.' : 'Replaces the English term and Russian translation in the draft. Your example stays; check that it matches. No card is saved yet.'}</p>
        </div>}
      </div>
    </details>
    <p role="status" aria-atomic="true" className={busy || notice ? 'mt-2 text-sm text-teal' : 'sr-only'}>{busy ? ru ? 'Готовим перевод.' : 'Preparing translation.' : notice}</p>
  </div>;
}
