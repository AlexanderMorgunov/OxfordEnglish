import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, PixelImage } from '@/shared/ui';
import { getDataScopeRevision, subscribeDataScope } from '@/features/account/dataScope';
import { useUiLang } from '@/features/i18n/uiLang';
import { installDictation, probeDictation, startDictation } from './dictation';
import { dictationError } from './dictation-types';
import type { DictationCapability, DictationError, DictationMode, DictationPhase, DictationSession } from './dictation-types';

const errors: Record<DictationError['code'], [string, string]> = {
  unsupported: ['Диктовка здесь недоступна. Введите текст или используйте микрофон клавиатуры.', 'Dictation is unavailable here. Type or use your keyboard microphone.'],
  permission: ['Доступ к микрофону запрещён. Разрешите его в настройках сайта или приложения и попробуйте снова.', 'Microphone access denied. Allow it in site or app settings and retry.'],
  language: ['Английская модель недоступна. Проверьте языки распознавания и повторите проверку; системный режим выбирается отдельно.', 'English model unavailable. Check speech languages and recheck; system mode must be selected separately.'],
  empty: ['Речь не распознана. Попробуйте ещё раз, говоря после появления «Слушаю».', 'No speech recognized. Retry, speaking after “Listening” appears.'],
  network: ['Сервис распознавания недоступен. Проверьте сеть или введите текст вручную.', 'Recognition service unavailable. Check connectivity or type manually.'],
  busy: ['Предыдущая диктовка ещё завершается. Подождите и попробуйте снова; обычный ввод доступен.', 'Previous dictation is still finishing. Wait and retry; typing remains available.'],
  failed: ['Не удалось начать или завершить диктовку. Попробуйте снова или введите текст вручную.', 'Could not start or finish dictation. Retry or type manually.'],
  timeout: ['Не удалось дождаться ответа. Попробуйте снова или введите текст вручную.', 'Response timed out. Retry or type manually.'],
  canceled: ['', ''],
};

function canUseMode(capability: DictationCapability | null, mode: DictationMode | null): boolean {
  return !!capability && (mode === 'local' ? capability.local === 'ready' || capability.local === 'unknown' : mode === 'system' && capability.system);
}

export function DictationInput({ draft, onAccept, onOpen, separator = ' ', limit, children, className }: {
  draft: string; onAccept: (text: string) => void; onOpen?: () => void; separator?: string; limit?: number;
  children?: ReactNode; className?: string;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const id = useId();
  const [opened, setOpened] = useState(false);
  const [mode, setMode] = useState<DictationMode | null>(null);
  const [capability, setCapability] = useState<DictationCapability | null>(null);
  const [operation, setOperation] = useState<'checking' | 'installing' | null>(null);
  const [phase, setPhase] = useState<DictationPhase | null>(null);
  const [preview, setPreview] = useState('');
  const [candidate, setCandidate] = useState<string | null>(null);
  const [error, setError] = useState<DictationError['code'] | null>(null);
  const [installed, setInstalled] = useState(false);
  const session = useRef<DictationSession | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const owner = useRef(getDataScopeRevision());
  const base = useRef(draft);
  const draftValue = useRef(draft);
  draftValue.current = draft;
  const opener = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const review = useRef<HTMLTextAreaElement>(null);
  const startButton = useRef<HTMLButtonElement>(null);
  const stopButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<'review' | 'start' | null>(null);
  useEffect(() => {
    if (phase) (phase === 'finishing' ? cancelButton : stopButton).current?.focus();
    else if (focusNext.current) {
      (focusNext.current === 'review' ? review : startButton).current?.focus();
      focusNext.current = null;
    }
  }, [phase, candidate, error]);
  useEffect(() => { if (opened) heading.current?.focus(); }, [opened]);
  const cancel = () => {
    focusNext.current = null;
    generation.current += 1; controller.current?.abort(); controller.current = null;
    session.current?.cancel(); session.current = null;
    setPhase(null); setPreview(''); setCandidate(null); setOperation(null); setError(null); setInstalled(false);
  };
  useEffect(() => {
    const clear = () => {
      focusNext.current = null;
      generation.current += 1; controller.current?.abort(); session.current?.cancel();
      controller.current = null; session.current = null;
      setPhase(null); setPreview(''); setCandidate(null); setOperation(null); setError(null); setInstalled(false);
    };
    const hidden = () => { if (document.hidden) clear(); };
    const unsubscribe = subscribeDataScope(clear);
    clear();
    document.addEventListener('visibilitychange', hidden); window.addEventListener('pagehide', clear);
    return () => {
      generation.current += 1; controller.current?.abort(); session.current?.cancel();
      unsubscribe(); document.removeEventListener('visibilitychange', hidden); window.removeEventListener('pagehide', clear);
    };
  }, [draft]);
  const valid = (version: number) => generation.current === version && owner.current === getDataScopeRevision() && base.current === draftValue.current;
  const check = async (preferred = mode) => {
    cancel(); owner.current = getDataScopeRevision(); base.current = draft;
    const version = generation.current; const work = new AbortController(); controller.current = work;
    setCapability(null); setMode(null); setOperation('checking');
    try {
      const result = await probeDictation(work.signal);
      if (valid(version)) {
        setCapability(result);
        setMode(canUseMode(result, preferred) ? preferred : canUseMode(result, 'local') ? 'local' : result.system ? 'system' : null);
      }
    }
    catch (failure) { if (valid(version)) setError(dictationError(failure).code); }
    finally { if (valid(version)) { controller.current = null; setOperation(null); } }
  };
  const install = async () => {
    cancel(); const version = generation.current; const work = new AbortController(); controller.current = work;
    setOperation('installing');
    try { await installDictation(work.signal); if (valid(version)) setInstalled(true); }
    catch (failure) { if (valid(version)) setError(dictationError(failure).code); }
    finally { if (valid(version)) { controller.current = null; setOperation(null); } }
  };
  const start = async () => {
    if (session.current || operation || !mode || !canUseMode(capability, mode)) return;
    cancel(); owner.current = getDataScopeRevision(); base.current = draft;
    const version = generation.current; setPhase('starting');
    const work = startDictation(mode, update => {
      if (!valid(version)) return;
      if (update.phase) setPhase(update.phase);
      if (update.preview !== undefined) setPreview(update.preview);
    });
    session.current = work;
    try {
      const text = await work.result;
      if (!valid(version)) return;
      focusNext.current = 'review'; setCandidate(text); setPreview('');
    } catch (failure) { if (valid(version)) { focusNext.current = 'start'; setPreview(''); setError(dictationError(failure).code); } }
    finally { if (valid(version)) { session.current = null; setPhase(null); } }
  };
  const close = () => { cancel(); setOpened(false); setMode(null); opener.current?.focus(); };
  const accept = (append: boolean) => {
    if (!valid(generation.current) || candidate === null) return;
    const text = candidate.trim(); const next = append && draft.trim() ? draft.trimEnd() + separator + text : text;
    if (!text || (limit !== undefined && next.length > limit)) return;
    cancel(); setOpened(false); setMode(null); onAccept(next);
  };
  const localAvailable = canUseMode(capability, 'local');
  const systemAvailable = canUseMode(capability, 'system');
  const canStart = !operation && canUseMode(capability, mode);
  const tooLong = limit !== undefined && (candidate?.trim().length ?? 0) > limit;
  const appendLength = draft.trim() ? draft.trimEnd().length + separator.length + (candidate?.trim().length ?? 0) : candidate?.trim().length ?? 0;
  return <div className={className ?? 'mt-3'} onKeyDown={event => { if (opened && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <Button ref={opener} variant="ghost" size="sm" className="min-h-11" aria-label={ru ? 'Диктовать на английском' : 'Dictate in English'} aria-expanded={opened} aria-controls={`${id}-panel`}
      onClick={() => { if (opened) { close(); return; } onOpen?.(); setOpened(true); void check(null); }}>
      {children ?? <><PixelImage src="/assets/pixel/ui/mic.png" alt="" aria-hidden="true" width={24} height={24} className="h-6 w-6 shrink-0" />
      {ru ? 'Диктовать на английском' : 'Dictate in English'}</>}
    </Button>
    {opened && <section id={`${id}-panel`} aria-labelledby={`${id}-heading`} className="col-span-full mt-3 w-full min-w-0 space-y-3 rounded-sm border border-line bg-surface p-3">
      <h2 ref={heading} id={`${id}-heading`} tabIndex={-1} className="text-base font-semibold">{ru ? 'Английская диктовка' : 'English dictation'}</h2>
      <p className="text-sm text-muted">{ru ? 'Говорите короткое слово, фразу или предложение на английском (en-US). До 30 секунд, затем проверьте результат.' : 'Speak a short English word, phrase or sentence (en-US). Up to 30 seconds, then check the result.'}</p>
      <label htmlFor={`${id}-mode`} className="block text-sm">{ru ? 'Распознавание' : 'Recognition mode'}</label>
      <select id={`${id}-mode`} value={mode ?? ''} disabled={!!operation || (!localAvailable && !systemAvailable)} aria-describedby={`${id}-privacy`}
        className="min-h-11 w-full rounded-sm border border-line bg-ink px-2 text-sm text-content"
        onChange={event => {
          const next = event.target.value;
          if ((next === 'local' || next === 'system') && canUseMode(capability, next)) { cancel(); setMode(next); }
        }}>
        {!mode && <option value="" disabled>{operation === 'checking' ? ru ? 'Проверяем…' : 'Checking…' : ru ? 'Недоступно' : 'Unavailable'}</option>}
        <option value="local" disabled={!localAvailable}>{ru ? 'На устройстве' : 'On device'}</option>
        <option value="system" disabled={!systemAvailable}>{ru ? 'Системный сервис' : 'System service'}</option>
      </select>
      <p id={`${id}-privacy`} className="text-xs text-muted">{mode === 'local'
        ? ru ? 'Аудио обрабатывается на устройстве. Нужна поддержка английского языка; автоматического перехода к системному сервису нет.' : 'Audio is processed on device. English support is required; there is no automatic switch to the system service.'
        : mode === 'system' ? ru ? 'Аудио может отправляться сервису распознавания браузера или Android. Может потребоваться сеть. Нажимая «Начать», вы выбираете этот режим.' : 'Audio may be sent to the browser or Android recognition service. Connectivity may be required. Pressing Start selects this mode.'
          : ru ? 'Диктовка начнётся только после нажатия «Начать».' : 'Dictation starts only after you press Start.'}</p>
      {capability && !localAvailable && !systemAvailable && <p className="text-sm text-muted">{ru ? 'Диктовка сейчас недоступна. Введите текст или используйте микрофон клавиатуры.' : 'Dictation is unavailable here. Type or use your keyboard microphone.'}</p>}
      {capability && capability.local !== 'ready' && (mode === 'local' || !localAvailable) && <p className="text-sm text-muted">{capability.local === 'unknown'
        ? ru ? 'Локальный движок найден, но готовность английского не подтверждена. Можно попробовать без передачи аудио в сеть.' : 'Local engine found, but English readiness is unverified. You can try without sending audio over the network.'
        : capability.local === 'downloadable' ? ru ? 'Нужна английская модель. На Android проверьте языки распознавания в настройках устройства.' : 'An English model is needed. On Android, check speech languages in device settings.'
        : capability.local === 'downloading' ? ru ? 'Модель скачивается. Повторите проверку после завершения.' : 'Model downloading. Recheck when finished.'
        : ru ? 'Локальная английская диктовка здесь недоступна.' : 'Local English dictation is unavailable here.'}</p>}
      {capability?.native && !capability.system && capability.local === 'unavailable' && <p className="text-xs text-muted">{ru ? 'Проверьте наличие службы распознавания и актуальной версии APK.' : 'Check that a recognition service and an up-to-date APK are installed.'}</p>}
      {!phase && <div className="flex flex-wrap gap-2">
        <Button ref={startButton} className="min-h-11" disabled={!canStart} onClick={() => void start()}>{ru ? 'Начать' : 'Start'}</Button>
        <Button variant="ghost" className="min-h-11" disabled={!!operation} onClick={() => void check()}>{ru ? 'Проверить снова' : 'Recheck'}</Button>
        {capability?.local === 'downloadable' && capability.install && !installed && <Button variant="ghost" className="min-h-11" disabled={!!operation} onClick={() => void install()}>{ru ? 'Скачать английскую модель' : 'Download English model'}</Button>}
      </div>}
      {(operation === 'installing' || installed) && <p className="text-xs text-muted">{ru ? 'Загрузка управляется браузером и может продолжаться после закрытия. После завершения нажмите «Проверить снова». Запись сама не начнётся.' : 'The browser owns this download and may continue after closing. Recheck when finished. Recording will not start automatically.'}</p>}
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-muted">{phase === 'starting' ? ru ? 'Подготавливаю микрофон… Разрешите доступ, если появится запрос.' : 'Preparing microphone… Allow access if prompted.'
        : phase === 'listening' ? ru ? 'Слушаю…' : 'Listening…' : phase === 'finishing' ? ru ? 'Завершаю распознавание…' : 'Finishing recognition…'
        : operation === 'checking' ? ru ? 'Проверяю доступность…' : 'Checking availability…' : operation === 'installing' ? ru ? 'Скачиваю модель…' : 'Downloading model…'
        : candidate !== null ? ru ? 'Результат готов. Проверьте текст перед вставкой.' : 'Result ready. Check the text before applying.' : ''}</p>
      {phase && <div className="flex flex-wrap gap-2">
        <Button ref={stopButton} className="min-h-11" disabled={phase === 'finishing'} onClick={() => session.current?.stop()}>{ru ? 'Остановить' : 'Stop'}</Button>
        <Button ref={cancelButton} variant="ghost" className="min-h-11" onClick={() => { cancel(); focusNext.current = 'start'; }}>{ru ? 'Отменить запись' : 'Cancel recording'}</Button>
      </div>}
      {preview && <p className="break-words whitespace-pre-wrap text-sm text-muted">{ru ? 'Предварительно: ' : 'Interim: '}{preview}</p>}
      {error && error !== 'canceled' && <p role="alert" className="text-sm text-coral">{errors[error][ru ? 0 : 1]}</p>}
      {candidate !== null && <div className="space-y-3">
        <label htmlFor={`${id}-candidate`} className="block text-sm">{ru ? 'Проверьте диктовку' : 'Check dictated text'}</label>
        <textarea ref={review} lang="en" id={`${id}-candidate`} value={candidate} rows={3} spellCheck={false} aria-invalid={tooLong}
          className="block w-full rounded-sm border border-line bg-ink p-3 text-base text-content"
          onChange={event => setCandidate(event.target.value)} />
        {tooLong && <p role="alert" className="text-sm text-coral">{ru ? `Сократите результат до ${limit} символов. Текст не обрезан.` : `Shorten the result to ${limit} characters. It has not been cut.`}</p>}
        <div className="flex flex-wrap gap-2">
          <Button className="min-h-11" disabled={!candidate.trim() || tooLong} onClick={() => accept(false)}>{draft.trim() ? ru ? 'Заменить текст' : 'Replace text' : ru ? 'Вставить текст' : 'Use text'}</Button>
          {draft.trim() && <Button variant="ghost" className="min-h-11" disabled={!candidate.trim() || (limit !== undefined && appendLength > limit)} onClick={() => accept(true)}>{ru ? 'Добавить к тексту' : 'Append to text'}</Button>}
        </div>
        {limit !== undefined && !tooLong && draft.trim() && appendLength > limit && <p className="text-xs text-muted">{ru ? 'Вместе с текущим текстом превышен лимит. Сократите текст или замените его.' : 'Combined text exceeds the limit. Shorten or replace the text.'}</p>}
      </div>}
      <Button variant="ghost" className="min-h-11" onClick={close}>{ru ? 'Закрыть диктовку' : 'Close dictation'}</Button>
    </section>}
  </div>;
}
