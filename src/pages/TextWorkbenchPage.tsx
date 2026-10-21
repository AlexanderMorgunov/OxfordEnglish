import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAiStore, isConfigured } from '@/features/ai/store';
import { aiAvailable, useAiEnabled } from '@/features/ai/route';
import { useEntitlement, hasManagedAi } from '@/features/account/entitlement';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { ReadingText } from '@/features/reader/reading-text';
import { BackToReader } from '@/features/reader/BackToReader';
import { DictationInput } from '@/features/vocab/DictationInput';
import { VocabularyNav } from '@/features/vocab/VocabularyNav';
import { ReplaceTranslationDialog } from '@/features/vocab/ReplaceTranslationDialog';
import { usePassageTranslation } from '@/features/vocab/usePassageTranslation';
import { prepareText, WORKBENCH_LIMIT, type TextIssue, type TextMode } from '@/features/vocab/text-workbench';

const ACTION = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-2 text-sm text-content hover:bg-surface-2 disabled:cursor-default disabled:opacity-40';
const EXAMPLE = 'I used to rush through every book. One evening, I decided to take my time. I read a little every day and wrote down the words I wanted to remember.\n\nAt first, progress seemed slow. Then I noticed that familiar phrases appeared again and again. Reading became easier, and I began to enjoy the story.';
type View = 'compose' | 'result' | 'source';
type Replacement = { source: string; mode: TextMode; continuing: boolean; resultId: number; resultText: string; owner: () => boolean; trigger: HTMLElement | null };

function useWideWorkspace() {
  const [wide, setWide] = useState(() => window.matchMedia?.('(min-width: 900px)')?.matches ?? false);
  useEffect(() => {
    const query = window.matchMedia?.('(min-width: 900px)');
    if (!query) return;
    const change = () => setWide(query.matches);
    query.addEventListener?.('change', change);
    return () => query.removeEventListener?.('change', change);
  }, []);
  return wide;
}

export function TextWorkbenchPage() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const config = useAiStore(s => s.config);
  const sessionRevision = useAccount(s => s.sessionRevision);
  const canAi = useAiEnabled();
  const entitlement = useEntitlement(s => s.entitlement);
  const { result: storedResult, start, cancel, editResult, getResult } = usePassageTranslation();
  const result = storedResult?.owned() ? storedResult : null;
  // Ownership and text reset together even when an external store renders first.
  const [draftState, setDraftState] = useState(() => ({ text: '', owned: captureDataScope() }));
  const draft = draftState.owned() ? draftState.text : '';
  const [mode, setMode] = useState<TextMode>(() => aiAvailable(config) ? 'ai' : 'free');
  const [view, setView] = useState<View>('compose');
  const [sourceSnapshot, setSourceSnapshot] = useState(() => ({ text: '', owned: captureDataScope() }));
  const [issue, setIssue] = useState<TextIssue | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [editNotice, setEditNotice] = useState(false);
  const [replacement, setReplacement] = useState<Replacement | null>(null);
  const [clipboard, setClipboard] = useState<'copied' | 'copy-error' | 'paste-error' | null>(null);
  const [inputRevision, setInputRevision] = useState(0);
  const wide = useWideWorkspace();
  const revision = useRef(0);
  const mounted = useRef(false);
  const sourceInput = useRef<HTMLTextAreaElement>(null);
  const sourceHeading = useRef<HTMLHeadingElement>(null);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const resultText = useRef<HTMLDivElement>(null);
  const resultEditor = useRef<HTMLTextAreaElement>(null);
  const doneButton = useRef<HTMLButtonElement>(null);
  const previousView = useRef<View>('compose');

  const focus = useCallback((target: HTMLElement | null) => {
    const owned = captureDataScope();
    requestAnimationFrame(() => {
      if (!mounted.current || !owned() || !target?.isConnected || !target.getClientRects().length) return;
      target.focus({ preventScroll: true });
      const bounds = target.getBoundingClientRect();
      if (bounds.top < 0 || bounds.bottom > window.innerHeight) target.scrollIntoView({ block: 'start', behavior: 'auto' });
    });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeDataScope(() => {
      revision.current += 1;
      setDraftState({ text: '', owned: captureDataScope() }); setMode('free'); setView('compose'); setSourceSnapshot({ text: '', owned: captureDataScope() });
      setEditing(null); setReplacement(null); setClipboard(null); setIssue(null);
      setInputRevision(value => value + 1);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, []);
  useEffect(() => { setReplacement(null); }, [config, sessionRevision]);
  useEffect(() => {
    const target = view === 'compose' ? sourceInput.current : view === 'source' ? sourceHeading.current : resultHeading.current;
    if (view !== 'compose' || previousView.current !== 'compose') {
      const owned = captureDataScope();
      requestAnimationFrame(() => {
        if (!mounted.current || !owned() || !target?.isConnected || !target.getClientRects().length) return;
        target.focus({ preventScroll: true });
        const bounds = target.getBoundingClientRect();
        if (bounds.top < 0 || bounds.bottom > window.innerHeight) target.scrollIntoView({ block: 'start', behavior: 'auto' });
      });
    }
    previousView.current = view;
  }, [view, result?.id]);
  const isEditing = editing !== null;
  useEffect(() => { if (isEditing) focus(resultEditor.current); }, [isEditing, focus]);

  const protectEditor = () => {
    if (!draftState.owned()) return true;
    if (editing === null) return false;
    setEditNotice(true); focus(doneButton.current);
    return true;
  };
  const navigate = (next: View) => {
    if (!draftState.owned()) return;
    if (protectEditor()) return;
    revision.current += 1; setClipboard(null); setView(next);
    if (next === 'compose') focus(sourceInput.current);
  };
  const updateDraft = (text: string) => {
    if (!draftState.owned()) return;
    revision.current += 1; cancel();
    setDraftState({ text, owned: captureDataScope() }); setIssue(null); setClipboard(null); setInputRevision(value => value + 1);
  };
  const validatedSource = () => {
    if (!draftState.owned()) return null;
    const prepared = prepareText(draft);
    setIssue(prepared.issue ?? null);
    if (prepared.issue) { focus(sourceInput.current); return null; }
    return prepared.text;
  };
  const begin = (source: string, selectedMode: TextMode, continuing: boolean) => {
    if (!draftState.owned()) return;
    revision.current += 1; setReplacement(null); setEditing(null); setEditNotice(false); setClipboard(null); setView('result');
    void start(source, selectedMode, continuing);
  };
  const request = (continuing = false) => {
    if (!draftState.owned()) return;
    if (protectEditor() || result?.state === 'loading') return;
    const source = continuing ? result?.source : validatedSource();
    if (!source) return;
    const selectedMode = continuing ? result?.mode ?? mode : mode;
    if (result?.edited) {
      setReplacement({ source, mode: selectedMode, continuing, resultId: result.id, resultText: result.text,
        owner: captureDataScope(), trigger: document.activeElement instanceof HTMLElement ? document.activeElement : null });
      return;
    }
    begin(source, selectedMode, continuing);
  };
  const openSource = (from: 'draft' | 'result' = 'result') => {
    if (!draftState.owned()) return;
    if (protectEditor()) return;
    const source = from === 'draft' ? validatedSource() : result?.source ?? validatedSource();
    if (!source) return;
    setSourceSnapshot({ text: source, owned: captureDataScope() });
    navigate('source');
  };
  const paste = async () => {
    if (!draftState.owned()) return;
    const owned = captureDataScope(); const version = revision.current;
    try {
      const text = await navigator.clipboard.readText();
      if (mounted.current && owned() && version === revision.current) { updateDraft(text); focus(sourceInput.current); }
    } catch {
      if (mounted.current && owned() && version === revision.current) { setClipboard('paste-error'); focus(sourceInput.current); }
    }
  };
  const copy = async () => {
    if (!draftState.owned()) return;
    if (!result?.text || editing !== null) return;
    const owned = captureDataScope(); const version = revision.current;
    const snapshot = result;
    const valid = () => {
      const current = getResult();
      return mounted.current && owned() && version === revision.current && current?.id === snapshot.id &&
        current.text === snapshot.text && (current.state === 'done') === (snapshot.state === 'done');
    };
    try {
      await navigator.clipboard.writeText(result.text);
      if (valid()) setClipboard('copied');
    } catch {
      if (valid()) setClipboard('copy-error');
    }
  };
  const selectResult = () => {
    if (!draftState.owned()) return;
    if (!resultText.current) return;
    const range = document.createRange(); range.selectNodeContents(resultText.current);
    const selection = window.getSelection(); selection?.removeAllRanges(); selection?.addRange(range);
    focus(resultText.current);
  };
  const commitEdit = () => {
    if (!draftState.owned()) return;
    if (editing === null) return;
    revision.current += 1; editResult(editing); setEditing(null); setEditNotice(false); setClipboard(null);
    focus(resultHeading.current);
  };
  const standaloneSource = sourceSnapshot.owned() ? sourceSnapshot.text : '';
  const readingSource = view === 'source' ? standaloneSource : result?.source ?? standaloneSource;
  const readingParagraphs = useMemo(() => readingSource.split(/\n{2,}/), [readingSource]);
  const normalizedDraft = prepareText(draft).text;
  const stale = !!result && normalizedDraft !== result.source;
  const loading = result?.state === 'loading';
  const partial = !!result && result.state !== 'done';
  const showReading = view !== 'compose' && (view === 'source' || wide);
  const invalid = issue ?? (draft.length > WORKBENCH_LIMIT ? 'too-long' : null);
  const hasKey = isConfigured(config);
  const hasManaged = hasManagedAi(entitlement);
  const failure = result?.error === 'quota' ? ru ? 'Лимит AI-запросов исчерпан. Можно выбрать бесплатный перевод или настроить свой AI-ключ.' : 'The AI budget is spent. You can choose free translation or configure your own AI key.'
    : result?.error === 'plan' ? ru ? 'Для нового AI-перевода нужен Pro или свой ключ. Сохранённые переводы остаются доступны.' : 'New AI translation needs Pro or your key. Cached translations remain available.'
      : result?.error === 'network' ? ru ? 'Нет связи с сервисом перевода. Проверьте сеть и повторите.' : 'No connection to the translation service. Check connectivity and retry.'
        : result?.error === 'timeout' ? ru ? 'Сервис не успел ответить. Можно повторить запрос.' : 'The service took too long. You can retry.'
          : ru ? 'Сервис перевода недоступен. Проверьте сеть или лимит сервиса и повторите.' : 'Translation unavailable. Check connectivity or service limits and retry.';
  const policy = mode === 'free' ? ru ? 'Бесплатный перевод · нужна сеть для нового текста.' : 'Free translation · new text needs a connection.'
    : hasManaged ? hasKey ? ru ? 'Pro · при сбое используется ваш AI-ключ.' : 'Pro · your AI key is used if Pro fails.' : ru ? 'Pro · используется лимит аккаунта. Свой ключ не нужен.' : 'Pro · uses your account budget. No personal key needed.'
      : hasKey ? ru ? 'Используется ваш AI-ключ и лимит провайдера.' : 'Uses your AI key and provider limits.'
        : canAi ? ru ? 'Проверим доступ к AI при переводе.' : 'AI access is checked when you translate.'
          : ru ? 'Сохранённые AI-переводы доступны. Для новых нужен Pro или свой ключ.' : 'Cached AI translations are available. New ones need Pro or your key.';

  return <section aria-label={ru ? 'Перевод текста' : 'Translate text'} className="min-w-0">
    <BackToReader />
    <VocabularyNav />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
      <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight"><PixelImage src="/assets/pixel/ui/translate.png" alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6 shrink-0" />{ru ? 'Перевод текста' : 'Translate text'}</h1>
      <p aria-label={ru ? 'С английского на русский' : 'English to Russian'} className="shrink-0 text-xs text-muted">EN → RU</p>
    </div>
    <div className="grid min-w-0 gap-7 min-[900px]:grid-cols-2 min-[900px]:gap-10">
      {(view !== 'result' || wide) && <section aria-label={ru ? 'Оригинал' : 'Source'} className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 ref={sourceHeading} tabIndex={-1} className="text-lg font-semibold">{ru ? 'Оригинал' : 'Source'} <span className="ml-1 text-xs font-normal text-muted">EN</span></h2>
          {view === 'compose' ? <button className={ACTION} disabled={loading} onClick={() => updateDraft(EXAMPLE)}>{ru ? 'Пример' : 'Example'}</button>
            : <button className={ACTION} disabled={loading} onClick={() => navigate('compose')}>{ru ? 'Изменить текст' : 'Edit source'}</button>}
        </div>
        {view === 'compose' && <form onSubmit={event => { event.preventDefault(); request(); }} className="min-w-0 space-y-3">
          <div className="overflow-hidden rounded-md border border-line bg-surface focus-within:border-teal">
            <label htmlFor="workbench-source" className="sr-only">{ru ? 'Текст на английском' : 'English text'}</label>
            <textarea ref={sourceInput} id="workbench-source" lang="en" value={draft} spellCheck={false} rows={5} readOnly={loading}
              aria-describedby="workbench-limit workbench-issue" aria-invalid={!!invalid}
              placeholder={ru ? 'Введите английский текст или вставьте его из буфера…' : 'Type English text or paste it here…'}
              className="block h-[170px] w-full resize-y bg-transparent p-3.5 text-base leading-relaxed text-content placeholder:text-muted focus:outline-none"
              onChange={event => updateDraft(event.target.value)}
              onKeyDown={event => { if (event.key === 'Enter' && event.ctrlKey && !event.nativeEvent.isComposing) { event.preventDefault(); request(); } }} />
            <div className="flex flex-wrap items-center gap-1 border-t border-line p-1.5">
              <button type="button" className={ACTION} disabled={loading} onClick={() => void paste()}>{ru ? 'Вставить' : 'Paste'}</button>
              <DictationInput key={inputRevision} className="contents" draft={draft} limit={WORKBENCH_LIMIT} separator={'\n\n'} onAccept={text => { if (!draftState.owned()) return; updateDraft(text); focus(sourceInput.current); }}>
                <PixelImage src="/assets/pixel/ui/mic.png" alt="" aria-hidden="true" width={20} height={20} className="h-5 w-5" />
              </DictationInput>
              <button type="button" className={ACTION} disabled={!draft || loading} onClick={() => { updateDraft(''); focus(sourceInput.current); }}>{ru ? 'Очистить' : 'Clear'}</button>
              <span id="workbench-limit" className="ml-auto min-w-0 text-right text-xs tabular-nums text-muted">{draft.length}/{WORKBENCH_LIMIT}</span>
            </div>
          </div>
          <p id="workbench-issue" role={invalid ? 'alert' : undefined} className={invalid ? 'text-sm text-coral' : 'sr-only'}>{invalid === 'too-long'
            ? ru ? 'Выберите фрагмент до 2000 символов. Текст не обрезан.' : 'Choose at most 2000 characters. Your text has not been cut.'
            : invalid === 'empty' ? ru ? 'Введите текст для перевода или чтения.' : 'Enter text to translate or read.'
              : invalid === 'not-english' ? ru ? 'Вставьте английский текст для перевода на русский.' : 'Paste English text to translate into Russian.' : ''}</p>
          {clipboard === 'paste-error' && <p role="status" className="text-sm text-amber">{ru ? 'Буфер недоступен. Используйте Ctrl+V или долгое нажатие в поле.' : 'Clipboard unavailable. Use Ctrl+V or long-press in the field.'}</p>}
          {stale && <p className="text-sm text-amber">{ru ? 'Исходник изменён. Прежний перевод сохранён для предыдущего текста.' : 'Source changed. The previous translation still belongs to the old text.'}</p>}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="workbench-mode" className="sr-only">{ru ? 'Режим перевода' : 'Translation mode'}</label>
            <select id="workbench-mode" value={mode} disabled={loading} onChange={event => { if (!draftState.owned()) return; revision.current += 1; cancel(); setMode(event.target.value as TextMode); setClipboard(null); }}
              className="min-h-11 max-w-full rounded-sm border border-line bg-surface px-3 py-2 text-sm text-content">
              <option value="free">{ru ? 'Бесплатный' : 'Free'}</option><option value="ai">{ru ? 'AI-перевод' : 'AI translation'}</option>
            </select>
            <Button type="submit" disabled={loading} style={{ fontFamily: 'var(--font-body)', letterSpacing: 'normal' }} className="min-h-12 px-5">{result ? ru ? 'Перевести заново' : 'Translate again' : ru ? 'Перевести' : 'Translate'}</Button>
          </div>
          <p className="text-xs leading-relaxed text-muted">{policy}</p>
          <details className="text-xs text-muted"><summary className="flex min-h-11 cursor-pointer items-center">{ru ? 'Как работает перевод' : 'How translation works'}</summary>
            <p className="py-2 leading-relaxed">{ru ? 'Текст отправляется выбранному сервису. AI расходует квоту Pro или средства провайдера вашего ключа. Отмена не гарантирует возврат уже потраченной квоты. Готовый перевод кешируется на устройстве; истории запросов нет.' : 'Your text is sent to the selected service. AI uses Pro quota or your provider balance. Cancellation does not guarantee a quota refund. Completed translations are cached on this device; there is no request history.'}</p>
          </details>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button type="button" className={ACTION} disabled={loading} onClick={() => openSource('draft')}>{ru ? 'Читать оригинал' : 'Read source'}</button>
            {result && <button type="button" className={ACTION} onClick={() => navigate('result')}>{ru ? 'К переводу' : 'Back to translation'}</button>}
            <span className="hidden text-xs text-muted min-[900px]:inline">Ctrl+Enter</span>
          </div>
        </form>}
        {showReading && !!readingSource && <div className="min-w-0 space-y-3">
          {result && <button className={`${ACTION} min-[900px]:hidden`} onClick={() => navigate('result')}>{ru ? 'К переводу' : 'Back to translation'}</button>}
          <p className="text-xs leading-relaxed text-muted">{ru ? 'Нажмите слово или выделите фразу, чтобы сохранить её с предложением в словарь.' : 'Tap a word or select a phrase to save it with its sentence in your vocabulary.'}</p>
          <ReadingText key={readingSource} paragraphs={readingParagraphs} />
          <Link to="/vocabulary" className="inline-flex min-h-11 items-center rounded-sm px-2 text-sm text-teal hover:bg-surface-2">{ru ? 'Открыть мой словарь' : 'Open my vocabulary'}</Link>
          {result?.text && readingSource === result.source && <details className="border-t border-line pt-2 min-[900px]:hidden"><summary className="flex min-h-11 cursor-pointer items-center text-sm text-teal">{ru ? 'Показать связанный перевод' : 'Show matching translation'}</summary>
            {partial && <p className="text-xs text-amber">{ru ? 'Перевод не завершён.' : 'Translation is incomplete.'}</p>}
            <p lang="ru" className="whitespace-pre-wrap text-base leading-relaxed [overflow-wrap:anywhere]">{result.text}</p>
          </details>}
        </div>}
      </section>}
      {result && (view === 'result' || (wide && (view !== 'source' || readingSource === result.source))) && <section aria-label={ru ? 'Перевод' : 'Translation'} className="min-w-0 space-y-4">
        <div className="border-b border-line pb-3 min-[900px]:hidden">
          <p lang="en" className="truncate text-sm text-muted">{result.source.split('\n')[0]}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            <button className={ACTION} disabled={loading} onClick={() => openSource('result')}>{ru ? 'Оригинал и слова' : 'Source and words'}</button>
            <button className={ACTION} disabled={loading} onClick={() => navigate('compose')}>{ru ? 'Изменить текст' : 'Edit source'}</button>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 ref={resultHeading} tabIndex={-1} className="text-lg font-semibold">{ru ? 'Перевод' : 'Translation'} <span className="ml-1 text-xs font-normal text-muted">RU</span></h2>
          <div className="flex flex-wrap gap-1">
            <button className={ACTION} disabled={!result.text.trim() || editing !== null} aria-label={partial ? ru ? 'Копировать готовую часть' : 'Copy completed part' : ru ? 'Копировать перевод' : 'Copy translation'} onClick={() => void copy()}>{partial ? ru ? 'Копировать часть' : 'Copy part' : ru ? 'Копировать' : 'Copy'}</button>
            <button className={ACTION} disabled={!result.text || loading || editing !== null} aria-label={ru ? 'Редактировать перевод' : 'Edit translation'} onClick={() => { if (!draftState.owned()) return; revision.current += 1; setEditing(result.text); setView('result'); setClipboard(null); focus(resultEditor.current); }}>{ru ? 'Править' : 'Edit'}</button>
          </div>
        </div>
        {stale && <div className="rounded-sm border border-amber-dim bg-amber-dim/20 p-3 text-sm text-amber"><p>{ru ? 'Ниже — перевод прежнего оригинала. Новая версия текста ещё не переведена.' : 'This answer belongs to the previous source. The new text has not been translated.'}</p></div>}
        <p role="status" aria-live="polite" className={loading ? 'text-sm text-muted' : 'sr-only'}>{loading ? ru ? `Переведено ${result.completed} из ${result.total} частей…` : `Translated ${result.completed} of ${result.total} parts…` : result.state === 'done' ? ru ? 'Перевод готов.' : 'Translation ready.' : ''}</p>
        {(loading || result.state === 'error' || result.state === 'cancelled') && <div className="space-y-2 rounded-sm border border-line bg-surface p-3">
          {!loading && <p role={result.state === 'error' ? 'alert' : 'status'} className="text-sm leading-relaxed text-muted">{result.state === 'cancelled'
            ? ru ? 'Перевод остановлен. Готовая часть сохранена.' : 'Translation stopped. Completed text is retained.'
            : result.text ? `${ru ? 'Получена часть перевода. Готовые фрагменты сохранены — можно продолжить.' : 'Part of the text is translated. Completed segments are retained; you can continue.'} ${failure}`
              : `${failure} ${ru ? 'Исходный текст сохранён.' : 'Your source text is retained.'}`}</p>}
          <Button variant="ghost" className="min-h-11" onClick={() => { if (!draftState.owned()) return; if (loading) { revision.current += 1; cancel(); focus(resultHeading.current); } else request(true); }}>{loading ? ru ? 'Отменить перевод' : 'Cancel translation' : result.text ? ru ? 'Продолжить перевод' : 'Continue translation' : ru ? 'Повторить перевод' : 'Retry translation'}</Button>
          {(result.error === 'quota' || result.error === 'plan') && !loading && <button className={ACTION} onClick={() => {
            if (protectEditor()) return;
            setMode('free'); navigate('compose');
          }}>{ru ? 'Выбрать бесплатный перевод' : 'Choose free translation'}</button>}
        </div>}
        {editing === null ? <div ref={resultText} tabIndex={-1} lang="ru" className="max-w-[65ch] space-y-5 text-lg leading-[1.8] [overflow-wrap:anywhere]">
          {result.text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap">{paragraph}</p>)}
        </div> : <div className="space-y-3">
          <label htmlFor="workbench-result" className="sr-only">{ru ? 'Русский перевод' : 'Russian translation'}</label>
          <textarea ref={resultEditor} id="workbench-result" lang="ru" rows={7} value={editing} className="block w-full resize-y rounded-sm border border-line bg-surface p-3 text-base leading-relaxed text-content" onChange={event => { if (draftState.owned()) setEditing(event.target.value); }} />
          <div className="flex flex-wrap gap-2"><Button ref={doneButton} onClick={commitEdit} className="min-h-11">{ru ? 'Готово' : 'Done'}</Button><button className={ACTION} onClick={() => { if (!draftState.owned()) return; setEditing(null); setEditNotice(false); focus(resultHeading.current); }}>{ru ? 'Отменить правку' : 'Cancel edit'}</button></div>
          {editNotice && <p role="status" className="text-sm text-amber">{ru ? 'Сначала завершите или отмените правку. Черновик сохранён.' : 'Finish or cancel your edit first. Your draft is retained.'}</p>}
        </div>}
        {clipboard === 'copied' && <p role="status" className="text-sm text-muted">{partial ? ru ? 'Готовая часть скопирована. Перевод не завершён.' : 'Completed part copied. Translation is incomplete.' : ru ? 'Скопировано.' : 'Copied.'}</p>}
        {clipboard === 'copy-error' && <div className="space-y-1"><p role="status" className="text-sm text-amber">{ru ? 'Буфер недоступен. Выделите текст и скопируйте вручную.' : 'Clipboard unavailable. Select the text and copy manually.'}</p><button className={ACTION} onClick={selectResult}>{ru ? 'Выделить перевод' : 'Select translation'}</button></div>}
        {!!result.text && <div className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
          <p>{result.mode === 'free' ? ru ? 'Бесплатный перевод' : 'Free translation'
            : result.paths.length ? ru ? `Получено через ${result.paths.map(path => path === 'managed' ? 'DayEnglish AI' : 'свой AI-ключ').join(' + ')}` : `Received via ${result.paths.map(path => path === 'managed' ? 'DayEnglish AI' : 'your AI key').join(' + ')}`
              : ru ? 'AI-перевод' : 'AI translation'}</p>
          {result.edited && <p className="mt-1">{ru ? 'Есть ваши правки · только в этой сессии' : 'Contains your edits · this session only'}</p>}
          {partial && <p className="mt-1">{ru ? `Не завершён: ${result.completed} из ${result.total} частей.` : `Incomplete: ${result.completed} of ${result.total} parts.`}</p>}
        </div>}
      </section>}
    </div>
    {replacement && <ReplaceTranslationDialog continuing={replacement.continuing} returnFocus={replacement.trigger}
      onClose={() => setReplacement(null)} onConfirm={() => {
        if (!replacement.owner() || result?.id !== replacement.resultId || result.text !== replacement.resultText || (!replacement.continuing && (normalizedDraft !== replacement.source || mode !== replacement.mode))) { setReplacement(null); return; }
        begin(replacement.source, replacement.mode, replacement.continuing);
      }} />}
  </section>;
}
