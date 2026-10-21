import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { db } from '@/db/db';
import { captureDataScope } from '@/features/account/dataScope';
import { AI_REQUEST_TIMEOUT, useAiEnabled, useAiUnknown } from '@/features/ai/route';
import { useAiStore } from '@/features/ai/store';
import { SenseTermSchema, SENSES_COST } from '@/features/ai/word-senses';
import type { WordSense } from '@/features/ai/word-senses';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button, PixelImage } from '@/shared/ui';
import { requestWordSenses } from './word-senses';
import type { SenseResult } from './word-senses';

const POS_RU: Record<WordSense['partOfSpeech'], string> = {
  noun: 'существительное', verb: 'глагол', adjective: 'прилагательное', adverb: 'наречие',
  pronoun: 'местоимение', preposition: 'предлог', conjunction: 'союз', interjection: 'междометие',
  determiner: 'определитель', phrase: 'фраза', other: 'другое',
};

export function WordSensesInput({ term, context, draftRevision, disabled, onChoose }: {
  term: string; context: string; draftRevision: number; disabled: boolean;
  onChoose: (sense: WordSense, useExample: boolean) => void;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const config = useAiStore(s => s.config);
  const enabled = useAiEnabled();
  const unknown = useAiUnknown();
  const [result, setResult] = useState<SenseResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState<WordSense | null>(null);
  const [notice, setNotice] = useState('');
  const active = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionLock = useRef(false);
  const requestButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const firstMeaning = useRef<HTMLButtonElement>(null);
  const focusAfterRequest = useRef(false);
  const panel = useRef<HTMLDetailsElement>(null);
  const summary = useRef<HTMLElement>(null);
  const exampleChoice = useRef<HTMLButtonElement>(null);
  const latestDraftRevision = useRef(draftRevision);
  useLayoutEffect(() => { latestDraftRevision.current = draftRevision; }, [draftRevision]);
  useEffect(() => { if (pending) exampleChoice.current?.focus(); }, [pending]);
  useEffect(() => {
    if (busy) cancelButton.current?.focus();
    else if (focusAfterRequest.current) {
      focusAfterRequest.current = false;
      if (panel.current?.open) (result?.senses.length ? firstMeaning : requestButton).current?.focus();
    }
  }, [busy, result]);
  const validTerm = SenseTermSchema.safeParse(term).success;
  const cancel = useCallback(() => {
    generation.current += 1;
    active.current?.abort(); active.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  useEffect(() => () => cancel(), [cancel]);
  useEffect(() => {
    if (disabled) { cancel(); setBusy(false); setPending(null); }
  }, [disabled, cancel]);

  const request = async () => {
    if (active.current || disabled || !panel.current?.open || !validTerm) return;
    cancel();
    const id = generation.current;
    const current = captureDataScope();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true); setError(''); setResult(null); setPending(null); setNotice('');
    const valid = () => current() && id === generation.current;
    timer.current = setTimeout(() => {
      if (!valid()) return;
      focusAfterRequest.current = document.activeElement === cancelButton.current;
      cancel(); setBusy(false);
      setError(ru ? 'Запрос занял слишком долго. Попробуйте ещё раз.' : 'The request timed out. Please try again.');
    }, AI_REQUEST_TIMEOUT + 2000);
    try {
      const proposal = await requestWordSenses(term, config, controller.signal);
      if (valid() && !controller.signal.aborted && panel.current?.open) {
        focusAfterRequest.current = document.activeElement === cancelButton.current;
        setResult(proposal);
        setNotice(ru ? `Готово: значений — ${proposal.senses.length}. Выберите подходящее.` : `Ready: ${proposal.senses.length} meanings. Choose the one you need.`);
      }
    } catch (cause) {
      if (valid() && !controller.signal.aborted) {
        focusAfterRequest.current = document.activeElement === cancelButton.current;
        setError(cause instanceof Error && cause.message === 'AI unavailable'
        ? ru ? 'Для нового запроса нужен активный trial/Pro или свой AI-ключ в настройках. Обычный перевод доступен.' : 'New requests require an active trial/Pro or your AI key in settings. Ordinary translation is available.'
        : ru ? 'Не удалось получить корректные значения. Попробуйте позже или добавьте слово с обычным переводом.' : 'Could not get valid meanings. Try later or add the term with ordinary translation.');
      }
    } finally {
      if (valid()) { cancel(); setBusy(false); }
    }
  };

  const choose = async (sense: WordSense, useExample: boolean) => {
    if (disabled || selectionLock.current) return;
    selectionLock.current = true;
    const id = generation.current;
    const revision = latestDraftRevision.current;
    const current = captureDataScope();
    try {
      const kind = /\s/.test(term.trim()) ? 'phrase' : 'word';
      const card = await db.srsCards.get(`${kind}:${term.trim().toLowerCase()}`);
      if (!current() || id !== generation.current || !panel.current?.open) return;
      if (revision !== latestDraftRevision.current) {
        setPending(null);
        setNotice(ru ? 'Черновик изменился. Выберите значение ещё раз.' : 'The draft changed. Choose the meaning again.');
        return;
      }
      if (card) {
        setError(ru ? 'У этого слова уже есть карточка. Отдельное значение пока сохранить нельзя. Изменить перевод можно в словаре ниже.'
          : 'This term already has a card. A separate meaning cannot be saved yet. You can edit its translation in the vocabulary below.');
        setPending(null);
        return;
      }
      onChoose(sense, useExample);
      setPending(null);
      setNotice(ru ? 'Значение перенесено в черновик. Проверьте поля и нажмите «Добавить».' : 'Meaning copied to the draft. Check the fields and press Add.');
      if (panel.current) panel.current.open = false;
    } catch {
      if (current() && id === generation.current) setError(ru ? 'Не удалось проверить карточку. Попробуйте ещё раз.' : 'Could not check the card. Please try again.');
    } finally { selectionLock.current = false; }
  };

  return <div className="min-w-0">
    <details ref={panel} className="rounded-md border border-line bg-ink p-3" onToggle={event => {
      if (event.currentTarget.open) return;
      cancel(); setBusy(false); setPending(null);
      if (event.currentTarget.contains(document.activeElement)) summary.current?.focus();
    }}>
      <summary ref={summary} className="min-h-11 cursor-pointer text-sm font-semibold text-content" onClick={() => {
        if (panel.current?.open) {
          cancel(); setBusy(false); setPending(null);
          if (busy) setNotice(ru ? 'Запрос отменён.' : 'Request cancelled.');
        }
      }}>
        <span className="inline-flex items-center gap-2 align-middle"><PixelImage src="/assets/pixel/ui/ai.png" alt="" aria-hidden="true" width={32} height={32} className="h-8 w-8 shrink-0" />{ru ? 'Значения · AI' : 'AI meanings'}</span>
      </summary>
      <div className="mt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button ref={requestButton} variant="ghost" className="min-h-11" disabled={disabled || busy || !validTerm} onClick={() => void request()}>
            {busy ? ru ? 'Ищем значения…' : 'Finding meanings…' : ru ? 'Значения и примеры · AI' : 'Meanings and examples · AI'}
          </Button>
          {busy && <Button ref={cancelButton} variant="ghost" className="min-h-11" onClick={() => {
            cancel(); setBusy(false); setNotice(ru ? 'Запрос отменён.' : 'Request cancelled.');
            requestAnimationFrame(() => { if (requestButton.current?.isConnected) requestButton.current.focus(); });
          }}>{ru ? 'Отменить запрос' : 'Cancel request'}</Button>}
        </div>
        <p className="mt-2 text-xs text-muted">{ru
          ? `Новый запрос: ${SENSES_COST} единицы AI-квоты; свой ключ — по тарифу провайдера, возможны повторы. Кеш устройства бесплатен. Отмена не гарантирует возврат квоты.`
          : `New request: ${SENSES_COST} AI quota units; your key uses provider billing and may retry. Device cache is free. Cancellation does not guarantee a refund.`}</p>
        {!enabled && !unknown && <p className="mt-1 text-xs text-muted">{ru ? 'Новые значения доступны с trial/Pro или своим ключом в настройках. Ранее полученные можно открыть из кеша.' : 'New meanings require trial/Pro or your key in settings. Previously fetched meanings can be opened from cache.'}</p>}
        {!!term.trim() && !validTerm && <p className="mt-1 text-xs text-muted">{ru ? 'Для значений введите короткое английское слово или фразу — до 80 символов.' : 'For meanings, enter a short English word or phrase, up to 80 characters.'}</p>}
        {error && <p role="alert" className="mt-2 text-sm text-coral">{error}</p>}
        {result && <div className="mt-3">
          <p className="mb-2 text-xs text-muted">{ru ? 'Предложения AI могут содержать ошибки. Выберите одно значение и проверьте его.' : 'AI suggestions may contain errors. Choose one meaning and check it.'} · {result.path === 'managed' ? 'DayEnglish AI' : ru ? 'свой AI-ключ' : 'your AI key'}{result.cached ? ru ? ' · из кеша' : ' · cached' : ''}</p>
          {!result.senses.length && <p role="status" className="text-sm text-muted">{ru ? 'Надёжных предложений нет. Введите перевод вручную или используйте обычный.' : 'No reliable suggestions. Enter a translation or use ordinary translation.'}</p>}
          <ul className="space-y-2">
            {result.senses.map((sense, index) => <li key={index} className="rounded-md border border-line bg-surface p-3 [overflow-wrap:anywhere]">
              <p className="text-xs text-muted">{ru ? POS_RU[sense.partOfSpeech] : sense.partOfSpeech}</p>
              <p lang="ru" className="font-semibold text-content">{sense.translation}</p>
              <p lang="ru" className="text-sm text-muted">{sense.distinction}</p>
              <p className="my-2 text-sm text-content" lang="en">{sense.example}</p>
              <Button ref={index === 0 ? firstMeaning : undefined} size="sm" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => {
                setError(''); setNotice('');
                if (context.trim() && context.trim() !== sense.example) {
                  setPending(sense);
                  setNotice(ru ? 'Выберите пример для этого значения.' : 'Choose an example for this meaning.');
                }
                else void choose(sense, true);
              }}>{ru ? `Выбрать значение ${index + 1}` : `Choose meaning ${index + 1}`}</Button>
              {pending === sense && <div className="mt-3 rounded-sm border border-teal-dim p-3" role="group" aria-label={ru ? 'Выбор примера' : 'Example choice'}>
                <p className="text-sm text-content">{ru ? `Выбрано: «${pending.translation}». Использовать предложенный пример или оставить свой, если он соответствует этому значению?` : `Selected: “${pending.translation}”. Use the suggested example or keep yours if it matches this meaning?`}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button ref={exampleChoice} size="sm" className="min-h-11" disabled={disabled} onClick={() => void choose(pending, true)}>{ru ? 'Использовать этот пример' : 'Use this example'}</Button>
                  <Button size="sm" variant="ghost" className="min-h-11" disabled={disabled} onClick={() => void choose(pending, false)}>{ru ? 'Мой пример подходит' : 'My example matches'}</Button>
                </div>
              </div>}
            </li>)}
          </ul>
        </div>}
      </div>
    </details>
    <p role="status" aria-atomic="true" className={busy || notice ? 'mt-2 text-sm text-teal' : 'sr-only'}>{busy ? ru ? 'Готовим предложения.' : 'Preparing suggestions.' : notice}</p>
  </div>;
}
