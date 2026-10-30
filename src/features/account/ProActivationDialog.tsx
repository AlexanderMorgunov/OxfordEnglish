import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Input, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAiStore, isConfigured } from '@/features/ai/store';
import { upsellTarget } from '@/features/ai/upsell';
import { useAccount, captureAccountSessionOwner } from './store';
import { accountsEnabled } from './config';
import { useEntitlement, hasManagedAi, planLine, subscriptionState, quotaNotice } from './entitlement';
import { useProActivation } from './proActivation';
import { SaveRecoveryKey } from './SaveRecoveryKey';
import { PurchaseActions } from './PurchaseActions';
import { trialNote } from './trialCopy';
import { useBillingCatalog } from './useBillingCatalog';
import { formatPrice } from './billing';
import { ProDemo } from './ProDemo';
import { ProConditions } from './ProConditions';
import { keyToBytes, splitCredential } from './keys';

export function ProActivationDialog() {
  const entry = useProActivation(s => s.entry);
  return entry ? <ActivationFlow /> : null;
}

function ActivationFlow() {
  const entry = useProActivation(s => s.entry);
  const close = useProActivation(s => s.close);
  const ru = useUiLang(s => s.lang) === 'ru';
  const location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const initial = useRef(entry);
  const mounted = useRef(true);
  const [step, setStep] = useState<'offer' | 'account' | 'login' | 'trial'>('offer');
  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState('');
  const [note, setNote] = useState('');
  const status = useAccount(s => s.status);
  const accountId = useAccount(s => s.accountId);
  const sessionRevision = useAccount(s => s.sessionRevision);
  const busy = useAccount(s => s.busy);
  const key = useAccount(s => s.pendingRecoveryKey);
  const entitlement = useEntitlement(s => s.entitlement);
  const loading = useEntitlement(s => s.loading);
  const trialError = useEntitlement(s => s.error);
  const hasKey = useAiStore(s => isConfigured(s.config));
  const target = upsellTarget(status, entitlement);
  const source = entry?.task.source ?? 'pro';
  const state = subscriptionState(entitlement, Date.now());
  const active = entitlement?.active && (state === 'pro' || state === 'trial');
  const ended = state === 'expired' || state === 'trial-over';
  const trialAvailable = status === 'anonymous' || state === 'none' && trialError !== 'trial_already_claimed';
  const ready = active && hasManagedAi(entitlement) && !(source === 'pro' && step === 'offer') || hasKey && source !== 'pro' && step === 'offer';
  const unknown = status === 'authenticated' && !entitlement;
  const view = key ? 'key' : busy ? 'waiting' : ready ? 'ready' : unknown ? 'checking'
    : step === 'trial' && !trialAvailable ? 'offer' : step;
  const { catalog, monthly, retry } = useBillingCatalog(trialAvailable && view === 'offer');
  const taskTitle = source === 'lesson' ? ru ? 'Разбор вашей ошибки' : 'Understand your mistake'
    : source === 'reader' ? ru ? 'Понять смысл' : 'Understand the meaning'
      : source === 'text' ? ru ? 'Понять свой текст' : 'Understand your text'
        : ru ? 'Помощь там, где трудно' : 'Help when you get stuck';
  const title = view === 'key' ? ru ? 'Сохраните ключ' : 'Save your key'
    : view === 'account' ? ru ? 'Создать аккаунт' : 'Create account'
      : view === 'login' ? ru ? 'Войти в свой аккаунт' : 'Sign in to your account'
        : view === 'trial' ? ru ? 'Включить пробный период' : 'Start your free trial'
          : view === 'ready' ? ru ? 'Можно продолжать' : 'You are ready to continue'
            : view === 'waiting' ? ru ? 'Подключаем аккаунт…' : 'Connecting your account…'
              : view === 'checking' ? ru ? 'Проверяем доступ' : 'Checking access'
                : ended ? state === 'expired' ? ru ? 'Подписка закончилась' : 'Your subscription has ended' : ru ? 'Пробный период закончился' : 'Your free trial has ended'
                  : active && source === 'pro' ? ru ? 'Ваша подписка' : 'Your subscription' : taskTitle;

  useLayoutEffect(() => {
    const el = dialog.current;
    const origin = initial.current;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    if (typeof el?.showModal === 'function') el.showModal();
    else el?.setAttribute('open', '');
    return () => {
      document.body.style.overflow = overflow;
      el?.close?.();
      const fallback = origin?.fallback?.isConnected ? origin.fallback : document.querySelector<HTMLElement>('main');
      const focus = origin?.trigger?.isConnected ? origin.trigger : fallback?.querySelector<HTMLElement>('button, input, a') ?? fallback;
      focus?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); dialog.current?.scrollTo?.(0, 0); }, [view]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setStep('offer'); setKeyInput(''); setKeyError(''); setNote(''); }, [sessionRevision]);
  useEffect(() => { if (location.pathname !== initial.current?.pathname) close(); }, [location.pathname, close]);
  useEffect(() => {
    if (accountId && !useEntitlement.getState().loading) void useEntitlement.getState().load();
  }, [accountId]);

  const createAccount = async () => {
    const owns = captureAccountSessionOwner();
    setNote('');
    try { await useAccount.getState().createAccount(); }
    catch {
      if (mounted.current && owns()) setNote(ru ? 'Не удалось создать аккаунт. Проверьте соединение и повторите.' : 'Could not create your account. Check your connection and retry.');
    }
  };
  const login = async () => {
    const owns = captureAccountSessionOwner();
    setNote(''); setKeyError('');
    try { keyToBytes(splitCredential(keyInput).key); }
    catch {
      setKeyError(ru ? 'Ключ неполный или неверного формата. Вставьте его целиком из сохранённого файла.' : 'This key is incomplete or malformed. Paste the full key from your saved file.');
      return;
    }
    try {
      await useAccount.getState().linkWithKey(keyInput);
      if (mounted.current) { setKeyInput(''); setStep('offer'); }
    } catch {
      if (mounted.current && owns()) {
        if (useAccount.getState().error === 'invalid_credentials') setKeyError(ru ? 'Ключ не подошёл. Проверьте его и повторите вход.' : 'This key did not work. Check it and try signing in again.');
        else setNote(ru ? 'Не удалось войти. Проверьте соединение и повторите вход.' : 'Could not sign in. Check your connection and try signing in again.');
      }
    }
  };
  const startTrial = async () => {
    if (useEntitlement.getState().loading) return;
    const owns = captureAccountSessionOwner();
    setNote('');
    const result = await useEntitlement.getState().claimTrial();
    if (mounted.current && owns() && result !== 'ok') setNote(trialNote(result, ru));
  };
  const settings = `/settings?from=${encodeURIComponent(entry?.pathname ?? '/pro')}`;
  const returnLabel = source === 'lesson' ? ru ? 'Вернуться к заданию' : 'Back to your exercise'
    : source === 'reader' ? ru ? 'Вернуться к чтению' : 'Back to reading'
      : source === 'text' ? ru ? 'Вернуться к тексту' : 'Back to your text'
        : ru ? 'Готово' : 'Done';

  return <dialog ref={dialog} aria-labelledby="pro-activation-title" onCancel={e => { e.preventDefault(); close(); }}
    onKeyDown={event => {
      if (event.key !== 'Tab') return;
      const controls = [...event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, summary, [tabindex]')]
        .filter(el => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length > 0);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && (document.activeElement === first || document.activeElement === heading.current)) {
        event.preventDefault(); last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first?.focus();
      }
    }}
    className="fixed left-[50vw] right-auto mx-0 my-auto max-h-[calc(100dvh-24px)] w-[min(34rem,calc(100vw-24px))] max-w-none -translate-x-1/2 overflow-y-auto overscroll-contain rounded-xl border border-line bg-surface p-5 text-content shadow-2xl backdrop:bg-black/65 sm:p-7 [overflow-wrap:anywhere]">
    <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
      <p className="flex min-h-11 items-center gap-2 font-mono text-xs text-violet"><PixelImage src="/assets/pixel/ui/ai.png" alt="" className="h-6 w-6 shrink-0" />DayEnglish Pro</p>
      <button type="button" className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-sm border border-line text-xl hover:bg-surface-2" onClick={close} aria-label={ru ? 'Закрыть подключение Pro' : 'Close Pro setup'}>×</button>
      <h2 ref={heading} tabIndex={-1} id="pro-activation-title" className="col-span-2 text-[calc(1.5rem*var(--app-text-scale,1))] font-semibold leading-tight tracking-tight outline-none">{title}</h2>
    </div>
    <div className="space-y-5">
      {['account', 'key', 'trial'].includes(view) && <p className="font-mono text-xs text-teal">{ru ? 'Шаг ' : 'Step '}{view === 'account' ? '1' : view === 'key' ? '2' : '3'}{ru ? ' из 3' : ' of 3'}</p>}
      {view === 'key' && key && <SaveRecoveryKey recoveryKey={key} accountId={accountId} onContinue={() => { useAccount.getState().confirmRecoveryKey(); setStep('trial'); setNote(''); }} />}
      {view === 'waiting' && <p role="status" className="text-sm leading-relaxed text-muted">{ru ? 'Можно вернуться к задаче. Запрос продолжится; при следующем открытии покажем результат и ключ.' : 'You can return to your task. The request will continue; reopen this window to see the result and key.'}</p>}
      {view === 'checking' && <>
        <p role="status" className="text-sm text-muted">{loading ? ru ? 'Получаем состояние подписки…' : 'Loading your subscription…' : ru ? 'Не удалось проверить подписку. Проверьте соединение и повторите.' : 'Could not check your subscription. Check your connection and retry.'}</p>
        <Button className="min-h-11" disabled={loading} onClick={() => void useEntitlement.getState().load()}>{ru ? 'Проверить подписку' : 'Check subscription'}</Button>
        <PurchaseActions />
      </>}
      {view === 'ready' && <>
        <p role="status" className="text-sm leading-relaxed text-muted">{hasManagedAi(entitlement)
          ? ru ? 'Всё готово. Вернитесь к задаче и нажмите нужную кнопку AI.' : 'All set. Return to your task and choose the AI action you need.'
          : ru ? 'AI уже настроен. Можно вернуться к задаче.' : 'AI is already set up. You can return to your task.'}</p>
        {entitlement && <p className="text-sm text-teal">{planLine(entitlement, subscriptionState(entitlement, Date.now()), ru)}</p>}
        <Button className="min-h-12 w-full" onClick={close}>{returnLabel}</Button>
      </>}
      {view === 'account' && <>
        <p className="text-sm leading-relaxed text-muted">{ru ? 'Он сохранит ваш доступ к Pro. Email и карта не нужны.' : 'It keeps your Pro access across devices. No email or card needed.'}</p>
        <Button className="min-h-12 w-full" onClick={() => void createAccount()}>{ru ? 'Создать аккаунт' : 'Create account'}</Button>
        <Button variant="ghost" className="min-h-11 w-full" onClick={() => { setStep('login'); setKeyError(''); setNote(''); }}>{ru ? 'У меня уже есть аккаунт' : 'I already have an account'}</Button>
        <button type="button" className="min-h-11 text-sm text-muted underline" onClick={() => { setStep('offer'); setNote(''); }}>{ru ? 'Назад' : 'Back'}</button>
      </>}
      {view === 'login' && <form className="space-y-4" onSubmit={e => { e.preventDefault(); void login(); }}>
        <label className="block text-sm" htmlFor="pro-account-key">{ru ? 'Ключ восстановления' : 'Recovery key'}</label>
        <Input id="pro-account-key" type="password" autoComplete="off" spellCheck={false} aria-invalid={!!keyError} aria-describedby={keyError ? 'pro-account-key-error' : undefined} value={keyInput} onChange={e => { setKeyInput(e.target.value); setKeyError(''); }} />
        {keyError && <p id="pro-account-key-error" role="alert" className="text-sm text-coral">{keyError}</p>}
        <Button type="submit" disabled={!keyInput.trim()} className="min-h-12 w-full">{ru ? 'Войти' : 'Sign in'}</Button>
        <Link className="inline-flex min-h-11 items-center text-sm text-teal underline" to={settings} onClick={close}>{ru ? 'Вход с другого устройства или восстановление' : 'Sign in from another device or recover access'}</Link>
        <button type="button" className="block min-h-11 text-sm text-muted underline" onClick={() => { setStep('account'); setNote(''); }}>{ru ? 'Назад' : 'Back'}</button>
      </form>}
      {view === 'trial' && <>
        <p className="text-sm leading-relaxed text-muted">{ru ? '14 дней Pro: разборы ошибок, перевод в контексте и синхронизация. Карта не нужна. После пробного периода списаний не будет.' : '14 days of Pro: explanations, in-context translation and sync. No card required and no charge after the trial.'}</p>
        <Button className="min-h-12 w-full" disabled={loading} onClick={() => void startTrial()}>{loading ? ru ? 'Проверяем активацию…' : 'Checking activation…' : ru ? 'Включить 14 дней бесплатно' : 'Start 14 days free'}</Button>
        <ProConditions ru={ru} />
      </>}
      {view === 'offer' && <>
        {ended && <p className="text-sm leading-relaxed text-muted">{ru ? 'Книги, слова и прогресс сохранены. Подключите Pro, чтобы снова пользоваться AI и синхронизацией.' : 'Your books, words and progress are saved. Get Pro to use AI and sync again.'}</p>}
        {active && entitlement ? <p className="text-sm text-teal">{planLine(entitlement, state, ru)}</p>
          : <ProDemo kind={source === 'pro' ? 'lesson' : source} ru={ru} />}
        {entry?.task.excerpt && !active && <details className="text-sm text-muted">
          <summary className="min-h-11 cursor-pointer">{source === 'lesson' ? ru ? 'Ваше задание сохранено' : 'Your exercise is saved' : ru ? 'Ваш текст сохранён' : 'Your text is saved'}</summary>
          <p>{entry.task.excerpt}</p>
          {entry.task.answer && <p className="mt-2">{ru ? 'Ваш ответ: ' : 'Your answer: '}{entry.task.answer}</p>}
        </details>}
        {active && <p className="text-sm text-amber">{quotaNotice(entitlement, ru)?.text}</p>}
        {!trialAvailable && !ended && !active && <p className="text-sm text-muted">{ru ? 'Вы уже попробовали Pro. Подключите подписку, чтобы продолжить.' : 'You have already tried Pro. Get a subscription to continue.'}</p>}
        {trialAvailable && accountsEnabled() ? <>
          <div className="rounded-md border border-violet-dim bg-violet-dim/15 p-4">
            <p className="font-semibold">{ru ? '14 дней бесплатно' : '14 days free'}</p>
            <p className="mt-1 text-sm text-muted">{ru ? 'Без карты и автоматических списаний' : 'No card or automatic charges'}</p>
          </div>
          <Button className="min-h-12 w-full" onClick={() => { setStep(status === 'anonymous' ? 'account' : 'trial'); setNote(''); }}>{ru ? 'Попробовать 14 дней' : 'Try 14 days'}</Button>
        </> : status === 'authenticated' && (ended || target !== 'quota-resets') ? <PurchaseActions /> : null}
        {trialAvailable && <>
          {catalog.state === 'ready' && monthly && catalog.value.available && <p className="text-xs text-muted">{ru ? `Затем — ${formatPrice(monthly.priceKopecks)} за ${monthly.days} дней, если захотите продолжить.` : `Then ${formatPrice(monthly.priceKopecks)} for ${monthly.days} days, if you choose to continue.`}</p>}
          {catalog.state === 'loading' && <p role="status" className="text-xs text-muted">{ru ? 'Проверяем цену…' : 'Checking the price…'}</p>}
          {catalog.state === 'error' && <div className="text-sm text-muted"><p>{ru ? 'Не удалось проверить цену Pro.' : 'Could not check the Pro price.'}</p><Button className="mt-2 min-h-11" variant="ghost" onClick={retry}>{ru ? 'Повторить загрузку цены' : 'Retry price'}</Button></div>}
        </>}
        {trialAvailable && <ProConditions ru={ru} />}
      </>}
      {note && <p role="alert" className="rounded-sm border border-amber-dim bg-amber-dim/10 p-3 text-sm">{note}</p>}
      {view !== 'ready' && <button type="button" className="min-h-11 w-full text-sm text-muted hover:text-content" onClick={close}>{view === 'offer' && !active ? ru ? 'Продолжить бесплатно' : 'Continue free' : returnLabel}</button>}
    </div>
  </dialog>;
}
