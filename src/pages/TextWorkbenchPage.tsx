import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAiStore, isConfigured } from '@/features/ai/store';
import { aiAvailable, useAiEnabled } from '@/features/ai/route';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { upsellTarget } from '@/features/ai/upsell';
import { useEntitlement, hasManagedAi } from '@/features/account/entitlement';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { ReadingText } from '@/features/reader/reading-text';
import { BackToReader } from '@/features/reader/BackToReader';
import { DictationInput } from '@/features/vocab/DictationInput';
import { VocabularyNav } from '@/features/vocab/VocabularyNav';
import { WorkbenchDisclosure } from '@/features/vocab/WorkbenchDisclosure';
import { ReplaceTranslationDialog } from '@/features/vocab/ReplaceTranslationDialog';
import { usePassageTranslation } from '@/features/vocab/usePassageTranslation';
import { prepareText, WORKBENCH_LIMIT, type TextIssue, type TextMode } from '@/features/vocab/text-workbench';

const ACTION = 'inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-sm px-2 text-sm text-content hover:bg-surface-2 disabled:cursor-default disabled:opacity-40';
type View = 'compose' | 'result' | 'source';
type Replacement = { source: string; mode: TextMode; continuing: boolean; target: 'draft' | 'result'; resultId: number; resultText: string; owner: () => boolean; trigger: HTMLElement | null };

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
  const accountStatus = useAccount(s => s.status);
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
  const [sourceEdit, setSourceEdit] = useState<{ text: string; mode: TextMode; view: View } | null>(null);
  const [clearedText, setClearedText] = useState<string | null>(null);
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
  const tabNavigation = useRef(false);

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
      setSourceEdit(null); setClearedText(null); setEditNotice(false);
      setInputRevision(value => value + 1);
    });
    return () => { mounted.current = false; unsubscribe(); };
  }, []);
  useEffect(() => { setReplacement(null); }, [config, sessionRevision]);
  useEffect(() => {
    if (tabNavigation.current) { tabNavigation.current = false; previousView.current = view; return; }
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
    setEditNotice(true); setView('result'); focus(doneButton.current?.disabled ? resultEditor.current : doneButton.current);
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
    setDraftState({ text, owned: captureDataScope() }); setIssue(null); setClipboard(null); setClearedText(null); setInputRevision(value => value + 1);
  };
  const editSource = () => {
    if (protectEditor() || loading) return;
    setSourceEdit(current => current ?? { text: draft, mode, view });
    navigate('compose');
  };
  const cancelSourceEdit = () => {
    if (!draftState.owned() || !sourceEdit) return;
    updateDraft(sourceEdit.text); setMode(sourceEdit.mode); setView(sourceEdit.view); setSourceEdit(null);
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
    revision.current += 1; setReplacement(null); setEditing(null); setEditNotice(false); setClipboard(null); setSourceEdit(null); setClearedText(null); setView('result');
    void start(source, selectedMode, continuing, { cacheOnly: selectedMode === 'ai' && !canAi });
  };
  const request = (continuing = false, target: 'draft' | 'result' = 'draft') => {
    if (!draftState.owned()) return;
    if (protectEditor() || result?.state === 'loading') return;
    const source = continuing || target === 'result' ? result?.source : validatedSource();
    if (!source) return;
    const selectedMode = mode;
    const resuming = continuing && result?.mode === selectedMode;
    if (result?.edited) {
      const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setReplacement({ source, mode: selectedMode, continuing: resuming, target, resultId: result.id, resultText: result.text,
        owner: captureDataScope(), trigger: activeElement?.closest('details')?.querySelector('summary') ?? activeElement });
      return;
    }
    begin(source, selectedMode, resuming);
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
    if (editing === null || !editing.trim()) return;
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
  const paired = !!result && (view !== 'source' || readingSource === result.source);
  const showSource = view !== 'result' || wide;
  const showReading = view !== 'compose' && showSource;
  const showTranslation = !!result && (view === 'result' || (wide && paired));
  const invalid = issue ?? (draft.length > WORKBENCH_LIMIT ? 'too-long' : null);
  const hasKey = isConfigured(config);
  const hasManaged = hasManagedAi(entitlement);
  const aiLocked = mode === 'ai' && !canAi;
  const accessTarget = upsellTarget(accountStatus, entitlement);
  const modeChanged = !!result && result.mode !== mode;
  const failure = result?.error === 'quota' ? ru ? 'Лимит AI-запросов исчерпан. Можно выбрать бесплатный перевод или настроить свой AI-ключ.' : 'The AI budget is spent. You can choose free translation or configure your own AI key.'
    : result?.error === 'cache' ? ru ? 'Полный AI-перевод не сохранён на этом устройстве. Можно перевести текст бесплатно.' : 'The full AI translation is not saved on this device. You can translate for free.'
      : result?.error === 'plan' ? ru ? 'Для нового AI-перевода нужен Pro или свой ключ. Сохранённые переводы остаются доступны.' : 'New AI translation needs Pro or your key. Cached translations remain available.'
      : result?.error === 'network' ? ru ? 'Нет связи с сервисом перевода. Проверьте сеть и повторите.' : 'No connection to the translation service. Check connectivity and retry.'
        : result?.error === 'timeout' ? ru ? 'Сервис не успел ответить. Можно повторить запрос.' : 'The service took too long. You can retry.'
          : ru ? 'Сервис перевода недоступен. Проверьте сеть или лимит сервиса и повторите.' : 'Translation unavailable. Check connectivity or service limits and retry.';
  const policy = mode === 'free' ? ru ? 'Бесплатный перевод · нужна сеть для нового текста.' : 'Free translation · new text needs a connection.'
    : hasManaged ? hasKey ? ru ? 'Pro · при сбое используется ваш AI-ключ.' : 'Pro · your AI key is used if Pro fails.' : ru ? 'Pro · используется лимит аккаунта. Свой ключ не нужен.' : 'Pro · uses your account budget. No personal key needed.'
      : hasKey ? ru ? 'Используется ваш AI-ключ и лимит провайдера.' : 'Uses your AI key and provider limits.'
        : canAi ? ru ? 'Проверим доступ к AI при переводе.' : 'AI access is checked when you translate.'
          : ru ? 'Сохранённые AI-переводы доступны. Для новых нужен Pro или свой ключ.' : 'Cached AI translations are available. New ones need Pro or your key.';

  const switchTab = (tab: 'source' | 'result', trigger?: HTMLButtonElement) => {
    if (!draftState.owned() || (tab === 'result' && view === 'result')) return;
    if (protectEditor()) return;
    revision.current += 1; setClipboard(null);
    if (tab === 'source' && result) setSourceSnapshot({ text: result.source, owned: captureDataScope() });
    const next = tab;
    if (next !== view) tabNavigation.current = true;
    setView(next); trigger?.focus();
  };
  const closeActions = (target: HTMLElement) => { const details = target.closest('details'); if (details) details.open = false; };
  const primary = <Button type="submit" disabled={loading} style={{ fontFamily: 'var(--font-body)', letterSpacing: 'normal' }} className="min-h-12 w-full gap-2 px-5 sm:w-auto">
    <PixelImage src="/assets/pixel/ui/translate.png" alt="" aria-hidden="true" width={20} height={20} className="h-5 w-5 shrink-0" />
    {aiLocked ? ru ? 'Проверить сохранённый AI-перевод' : 'Check saved AI translation' : result ? ru ? 'Обновить перевод' : 'Translate again' : ru ? 'Перевести текст' : 'Translate'}
  </Button>;
  const aiAccessNotice = aiLocked && <div className="mt-3 space-y-2 rounded-sm border border-line bg-ink/40 p-3 text-xs leading-relaxed text-muted">
    <p>{ru ? '🔒 Новые AI-переводы сейчас недоступны. Ранее полученный перевод можно открыть из кеша.' : '🔒 New AI translations are unavailable. You can check for a previously saved translation.'}</p>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <AiUpsellLink className="min-h-11">{ru ? 'Доступ к AI в Pro →' : 'AI in Pro →'}</AiUpsellLink>
      {['plans', 'quota-final', 'quota-until-renewal'].includes(accessTarget) && <Link to="/settings?from=%2Fvocabulary%2Ftext#ai-section" className="inline-flex min-h-11 items-center text-teal hover:underline">{ru ? 'Настроить свой AI-ключ →' : 'Set up your own AI key →'}</Link>}
    </div>
  </div>;
  const settings = <details className="min-w-0 flex-1" onKeyDown={event => {
    if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); }
  }}>
    <summary className="flex min-h-11 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 text-xs">
      <span className="font-medium text-content">{aiLocked ? '🔒 ' : ''}{mode === 'ai' ? ru ? 'AI-перевод' : 'AI translation' : ru ? 'Бесплатный перевод' : 'Free translation'}</span>
      <span className="inline-flex items-center gap-1 text-teal"><PixelImage src="/assets/pixel/nav/settings.png" alt="" aria-hidden="true" width={16} height={16} className="h-4 w-4 shrink-0" />{ru ? 'Настроить' : 'Settings'}</span>
    </summary>
    <div className="space-y-3 py-3">
      <label htmlFor="workbench-mode" className="block text-sm">{ru ? 'Режим перевода' : 'Translation mode'}</label>
      <select id="workbench-mode" value={mode} disabled={loading} onChange={event => { if (!draftState.owned()) return; revision.current += 1; cancel(); setMode(event.target.value as TextMode); setClipboard(null); }} className="min-h-11 w-full rounded-sm border border-line bg-ink px-3 py-2 text-sm text-content">
        <option value="free">{ru ? 'Бесплатный' : 'Free'}</option><option value="ai">{!canAi ? '🔒 ' : ''}{ru ? 'AI-перевод' : 'AI translation'}</option>
      </select>
      <p className="text-xs leading-relaxed text-muted">{policy}</p>
      <p className="text-xs leading-relaxed text-muted">{ru ? 'Текст отправляется выбранному сервису. AI расходует квоту Pro или средства провайдера вашего ключа. Отмена не гарантирует возврат уже потраченной квоты. Готовые переводы кешируются на устройстве; истории запросов нет.' : 'Your text is sent to the selected service. AI uses Pro quota or your provider balance. Cancellation does not guarantee a quota refund. Completed translations are cached on this device; there is no request history.'}</p>
    </div>
  </details>;

  return <section aria-label={ru ? 'Перевод текста' : 'Translate text'} className="min-w-0">
    <BackToReader />
    <VocabularyNav />
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight"><PixelImage src="/assets/pixel/ui/translate.png" alt="" aria-hidden="true" width={28} height={28} className="h-7 w-7 shrink-0" />{ru ? 'Перевод текста' : 'Translate text'}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">{ru ? 'Поймите текст и сохраните слова, которые хотите запомнить.' : 'Understand a text and save the words you want to remember.'}</p>
      </div>
      <p className="text-xs text-muted">{ru ? 'Английский → Русский' : 'English → Russian'}</p>
    </div>
    {paired && !wide && <div role="tablist" aria-label={ru ? 'Оригинал и перевод' : 'Source and translation'} className="mb-4 grid grid-cols-2 gap-1 rounded-md border border-line bg-surface p-1"
      onKeyDown={event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault();
        const source = event.key === 'Home' || (event.key !== 'End' && view === 'result');
        const tab = event.currentTarget.querySelector<HTMLButtonElement>(source ? '#workbench-source-tab' : '#workbench-result-tab');
        switchTab(source ? 'source' : 'result', tab ?? undefined);
      }}>
      {(['source', 'result'] as const).map(tab => <button key={tab} id={`workbench-${tab}-tab`} type="button" role="tab" aria-controls={`workbench-${tab}-pane`} aria-selected={tab === 'result' ? view === 'result' : view !== 'result'} tabIndex={(tab === 'result' ? view === 'result' : view !== 'result') ? 0 : -1}
        className={`${ACTION} px-2 py-2 ${(tab === 'result' ? view === 'result' : view !== 'result') ? 'bg-surface-2 text-teal' : 'text-muted'}`} onClick={event => switchTab(tab, event.currentTarget)}>{tab === 'source' ? ru ? 'Оригинал и слова' : 'Source and words' : ru ? 'Перевод' : 'Translation'}</button>)}
    </div>}
    <div className={`min-w-0 rounded-lg border border-line bg-surface${paired && wide ? ' grid grid-cols-2' : ''}`}>
      <section id="workbench-source-pane" role={paired && !wide ? 'tabpanel' : undefined} aria-labelledby={paired && !wide ? 'workbench-source-tab' : 'workbench-source-heading'} hidden={!showSource} className="min-w-0 p-4 sm:p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-1">
          <h2 id="workbench-source-heading" ref={sourceHeading} tabIndex={-1} className="text-base font-semibold">{ru ? 'Оригинал' : 'Source'} <span className="ml-2 text-xs font-normal text-muted">EN</span></h2>
          {view !== 'compose' && <button type="button" className={`${ACTION} text-teal`} disabled={loading} onClick={editSource}>{ru ? 'Изменить' : 'Edit source'}</button>}
        </div>
        {view === 'compose' && <form onSubmit={event => { event.preventDefault(); request(); }} className="min-w-0">
          <label htmlFor="workbench-source" className="sr-only">{ru ? 'Текст на английском' : 'English text'}</label>
          <textarea ref={sourceInput} id="workbench-source" lang="en" value={draft} spellCheck={false} rows={7} readOnly={loading} aria-describedby="workbench-limit workbench-issue" aria-invalid={!!invalid}
            placeholder={ru ? 'Вставьте или напишите текст на английском…' : 'Paste or type English text…'}
            className="block min-h-52 w-full resize-y rounded-sm bg-transparent px-2 py-3 text-base leading-[1.8] text-content placeholder:text-muted focus:outline-teal"
            onChange={event => updateDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); request(); } }} />
          <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-line pt-2">
            <button type="button" className={`${ACTION} text-teal`} disabled={loading} onClick={() => void paste()}>{ru ? 'Вставить' : 'Paste'}</button>
            <button type="button" className={`${ACTION} text-muted`} disabled={!draft || loading} onClick={() => { if (!draftState.owned()) return; const saved = draft; updateDraft(''); setClearedText(saved); focus(sourceInput.current); }}>{ru ? 'Очистить' : 'Clear'}</button>
            <span id="workbench-limit" className={`ml-auto min-w-0 text-right text-xs tabular-nums ${draft.length > WORKBENCH_LIMIT ? 'text-coral' : 'text-muted'}`}>{draft.length} / {WORKBENCH_LIMIT}</span>
            <WorkbenchDisclosure label={ru ? 'Ещё' : 'More input options'} className="w-full">
              <div className="flex flex-wrap items-center gap-2 rounded-sm bg-ink/40 p-2">
                {!loading && <DictationInput key={inputRevision} className="contents" draft={draft} limit={WORKBENCH_LIMIT} separator={'\n\n'} onAccept={text => { if (!draftState.owned()) return; updateDraft(text); focus(sourceInput.current); }} />}
                <button type="button" className={ACTION} disabled={loading} onClick={() => openSource('draft')}><PixelImage src="/assets/pixel/nav/library.png" alt="" aria-hidden="true" width={20} height={20} className="h-5 w-5 shrink-0" />{ru ? 'Читать без перевода' : 'Read source'}</button>
              </div>
            </WorkbenchDisclosure>
          </div>
          <p id="workbench-issue" role={invalid ? 'alert' : undefined} className={invalid ? 'mt-3 text-sm text-coral' : 'sr-only'}>{invalid === 'too-long' ? ru ? 'Выберите фрагмент до 2000 символов. Текст не обрезан.' : 'Choose at most 2000 characters. Your text has not been cut.' : invalid === 'empty' ? ru ? 'Введите текст для перевода или чтения.' : 'Enter text to translate or read.' : invalid === 'not-english' ? ru ? 'Вставьте английский текст для перевода на русский.' : 'Paste English text to translate into Russian.' : ''}</p>
          {clearedText !== null && <div className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted" role="status"><span>{ru ? 'Поле очищено.' : 'Text cleared.'}</span><button type="button" className={`${ACTION} text-teal`} onClick={() => { if (!draftState.owned()) return; updateDraft(clearedText); focus(sourceInput.current); }}>{ru ? 'Восстановить текст' : 'Restore text'}</button></div>}
          {clipboard === 'paste-error' && <p role="status" className="mt-3 text-sm text-amber">{ru ? 'Буфер недоступен. Используйте Ctrl+V или долгое нажатие в поле.' : 'Clipboard unavailable. Use Ctrl+V or long-press in the field.'}</p>}
          {stale && <p className="mt-3 text-xs text-amber">{ru ? 'Исходник изменён. Прежний перевод сохранён для предыдущего текста.' : 'Source changed. The previous translation still belongs to the old text.'}</p>}
          <div className="mt-4 flex flex-wrap items-start gap-3 border-t border-line pt-4">{settings}{primary}</div>
          {sourceEdit && <button type="button" className={`${ACTION} mt-2 text-muted`} onClick={cancelSourceEdit}>{ru ? 'Отменить изменения' : 'Cancel source changes'}</button>}
          {result && <button type="button" className={`${ACTION} mt-2`} onClick={() => navigate('result')}>{ru ? 'К переводу' : 'Back to translation'}</button>}
        </form>}
        {showReading && !!readingSource && <div className="min-w-0 space-y-4">
          <p className="text-xs leading-relaxed text-muted">{ru ? 'Нажмите слово или выделите фразу, чтобы сохранить её с предложением в словарь.' : 'Tap a word or select a phrase to save it with its sentence in your vocabulary.'}</p>
          <ReadingText key={readingSource} paragraphs={readingParagraphs} />
          {!paired && result && <button type="button" className={ACTION} onClick={() => navigate('result')}>{ru ? 'К переводу' : 'Back to translation'}</button>}
          <div className="border-t border-line pt-3">{paired ? settings : <form onSubmit={event => { event.preventDefault(); request(); }} className="flex flex-wrap items-start gap-3">{settings}{primary}</form>}</div>
        </div>}
        {aiAccessNotice}
      </section>
      {result && paired && <section id="workbench-result-pane" role={!wide ? 'tabpanel' : undefined} aria-labelledby={!wide ? 'workbench-result-tab' : 'workbench-result-heading'} hidden={!showTranslation} className={`min-w-0 space-y-4 p-4 sm:p-5 ${wide ? 'border-l border-line bg-surface-2/20' : ''}`}>
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 id="workbench-result-heading" ref={resultHeading} tabIndex={-1} className="text-base font-semibold">{ru ? 'Перевод' : 'Translation'} <span className="ml-2 text-xs font-normal text-muted">RU</span></h2>
          <div className="flex min-w-0 flex-wrap items-start gap-1">
            <button type="button" className={ACTION} disabled={!result.text.trim() || editing !== null} aria-label={partial ? ru ? 'Копировать готовую часть' : 'Copy completed part' : ru ? 'Копировать перевод' : 'Copy translation'} onClick={() => void copy()}>{ru ? 'Копировать' : 'Copy'}</button>
            <WorkbenchDisclosure label={ru ? 'Ещё' : 'Translation actions'} className="relative">
              <div className="absolute right-0 top-full z-20 grid w-[min(16rem,calc(100vw-4rem))] gap-1 rounded-md border border-line bg-ink p-2 shadow-lg" onClick={event => { if (event.target instanceof HTMLElement && event.target.closest('button')) closeActions(event.currentTarget); }}>
                <button type="button" className={`${ACTION} justify-start text-left`} disabled={!result.text || loading || editing !== null} onClick={() => { if (!draftState.owned()) return; revision.current += 1; setEditing(result.text); setView('result'); setClipboard(null); }}>{ru ? 'Править перевод' : 'Edit translation'}</button>
                <button type="button" className={`${ACTION} justify-start text-left`} disabled={loading || editing !== null} onClick={() => request(false, 'result')}>{aiLocked ? ru ? 'Проверить сохранённый AI-перевод' : 'Check saved AI translation' : ru ? 'Перевести заново' : 'Retranslate source'}</button>
                {!wide && <button type="button" className={`${ACTION} justify-start text-left`} disabled={loading} onClick={editSource}>{ru ? 'Изменить оригинал' : 'Edit source'}</button>}
              </div>
            </WorkbenchDisclosure>
          </div>
        </div>
        {stale && <p className="rounded-sm border-l-2 border-amber bg-amber-dim/20 p-3 text-xs text-amber">{ru ? 'Это перевод прежнего оригинала. Новая версия текста ещё не переведена.' : 'This answer belongs to the previous source. The new text has not been translated.'}</p>}
        <p role="status" aria-live="polite" className={loading ? 'text-sm text-muted' : 'sr-only'}>{loading ? ru ? `Переводим текст… Готово ${result.completed} из ${result.total} частей.` : `Translated ${result.completed} of ${result.total} parts…` : result.state === 'done' ? ru ? 'Перевод готов.' : 'Translation ready.' : ''}</p>
        {(loading || result.state === 'error' || result.state === 'cancelled') && <div className="space-y-2 rounded-sm border border-line bg-ink/40 p-3">
          {!loading && <p role={result.state === 'error' ? 'alert' : 'status'} className="text-sm text-amber">{result.state === 'cancelled' ? ru ? 'Перевод остановлен. Исходник и готовая часть сохранены.' : 'Translation stopped. Source and completed text are retained.' : result.text ? `${ru ? 'Получена часть перевода. Готовые фрагменты сохранены — можно продолжить.' : 'Part of the text is translated. Completed segments are retained; you can continue.'} ${failure}` : `${failure} ${ru ? 'Исходный текст сохранён.' : 'Your source text is retained.'}`}</p>}
          {!loading && modeChanged && <p className="text-xs text-muted">{ru ? 'Режим изменён. Весь оригинал будет переведён заново выбранным способом.' : 'Mode changed. The full original will be translated again using your selection.'}</p>}
          <button type="button" className={`${ACTION} text-teal`} onClick={() => { if (!draftState.owned()) return; if (loading) { revision.current += 1; cancel(); focus(resultHeading.current); } else request(true); }}>{loading ? ru ? 'Отменить перевод' : 'Cancel translation' : aiLocked ? ru ? 'Проверить сохранённый AI-перевод' : 'Check saved AI translation' : modeChanged ? mode === 'free' ? ru ? 'Перевести бесплатно' : 'Translate for free' : ru ? 'Перевести с AI' : 'Translate with AI' : result.text ? ru ? 'Продолжить перевод' : 'Continue translation' : ru ? 'Повторить перевод' : 'Retry translation'}</button>
          {result.state === 'error' && result.mode === 'ai' && mode !== 'free' && <button type="button" className={`${ACTION} text-teal`} onClick={() => { if (protectEditor()) return; setMode('free'); editSource(); }}>{ru ? 'Выбрать бесплатный перевод' : 'Choose free translation'}</button>}
        </div>}
        {!wide && aiAccessNotice}
        {editing === null ? <div ref={resultText} tabIndex={-1} lang="ru" className="space-y-5 text-base leading-[1.9] [overflow-wrap:anywhere]">{result.text.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => <p key={index} className="whitespace-pre-wrap">{paragraph}</p>)}</div> : <div className="space-y-3">
          <label htmlFor="workbench-result" className="sr-only">{ru ? 'Русский перевод' : 'Russian translation'}</label>
          <textarea ref={resultEditor} id="workbench-result" lang="ru" rows={8} value={editing} aria-invalid={!editing.trim()} aria-describedby={!editing.trim() ? 'workbench-edit-issue' : undefined} className="block w-full resize-y rounded-sm border border-line bg-ink p-3 text-base leading-[1.8] text-content" onChange={event => { if (draftState.owned()) setEditing(event.target.value); }} />
          {!editing.trim() && <p id="workbench-edit-issue" role="status" className="text-sm text-amber">{ru ? 'Введите перевод или отмените правку. Прежний текст сохранён.' : 'Enter a translation or cancel your edit. The previous text is retained.'}</p>}
          <div className="flex flex-wrap gap-2"><Button ref={doneButton} onClick={commitEdit} disabled={!editing.trim()} className="min-h-11" style={{ fontFamily: 'var(--font-body)', letterSpacing: 'normal' }}>{ru ? 'Сохранить правку' : 'Save edit'}</Button><button type="button" className={ACTION} onClick={() => { if (!draftState.owned()) return; setEditing(null); setEditNotice(false); focus(resultHeading.current); }}>{ru ? 'Отменить правку' : 'Cancel edit'}</button></div>
          {editNotice && <p role="status" className="text-sm text-amber">{ru ? 'Сначала сохраните или отмените правку. Введённый текст остаётся в редакторе.' : 'Finish or cancel your edit first. Your draft is retained.'}</p>}
        </div>}
        {clipboard === 'copied' && <p role="status" className="text-xs text-muted">{partial ? ru ? 'Готовая часть скопирована. Перевод не завершён.' : 'Completed part copied. Translation is incomplete.' : ru ? 'Скопировано.' : 'Copied.'}</p>}
        {clipboard === 'copy-error' && <div className="space-y-1"><p role="status" className="text-sm text-amber">{ru ? 'Буфер недоступен. Выделите текст и скопируйте вручную.' : 'Clipboard unavailable. Select the text and copy manually.'}</p><button type="button" className={ACTION} onClick={selectResult}>{ru ? 'Выделить перевод' : 'Select translation'}</button></div>}
        {!!result.text && <div className="border-t border-line pt-3 text-xs leading-relaxed text-muted"><p>{result.mode === 'free' ? ru ? 'Бесплатный перевод' : 'Free translation' : result.paths.length ? ru ? `Получено через ${result.paths.map(path => path === 'managed' ? 'DayEnglish AI' : 'свой AI-ключ').join(' + ')}` : `Received via ${result.paths.map(path => path === 'managed' ? 'DayEnglish AI' : 'your AI key').join(' + ')}` : ru ? 'AI-перевод' : 'AI translation'}</p>
          {result.edited && <p className="mt-1">{ru ? 'Есть ваши правки · только в этой сессии' : 'Contains your edits · this session only'}</p>}
          {partial && <p className="mt-1">{ru ? `Не завершён: ${result.completed} из ${result.total} частей.` : `Incomplete: ${result.completed} of ${result.total} parts.`}</p>}
        </div>}
      </section>}
    </div>
    {view === 'compose' && !result && <p className="mt-4 text-xs leading-relaxed text-muted">{aiLocked ? ru ? 'Ctrl + Enter — проверить сохранённый AI-перевод.' : 'Ctrl + Enter to check the saved AI translation.' : ru ? 'Ctrl + Enter — перевести текст.' : 'Ctrl + Enter to translate.'}</p>}
    {replacement && <ReplaceTranslationDialog continuing={replacement.continuing} returnFocus={replacement.trigger} onClose={() => setReplacement(null)} onConfirm={() => {
      if (!replacement.owner() || result?.id !== replacement.resultId || result.text !== replacement.resultText || (!replacement.continuing && replacement.target === 'draft' && (normalizedDraft !== replacement.source || mode !== replacement.mode))) { setReplacement(null); return; }
      begin(replacement.source, replacement.mode, replacement.continuing);
    }} />}
  </section>;
}
