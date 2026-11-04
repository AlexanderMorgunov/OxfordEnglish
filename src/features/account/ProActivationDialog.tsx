import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button, PixelImage } from '@/shared/ui';
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
import { AccessFlow } from './AccessFlow';
import { showAccountAccessNotice } from './signupNotice';
import { lockBodyScroll } from '@/shared/lib/scroll-lock';
import { ReaderWordActivationDialog } from './ReaderWordActivationDialog';

export function ProActivationDialog() {
  const entry = useProActivation(s => s.entry);
  return entry?.kind === 'reader-word' ? <ReaderWordActivationDialog entry={entry} /> : entry ? <ActivationFlow /> : null;
}

function ActivationFlow() {
  const entry = useProActivation(s => s.entry);
  const closeNow = useProActivation(s => s.close);
  const ru = useUiLang(s => s.lang) === 'ru';
  const location = useLocation();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const leaveNotice = useRef<HTMLDivElement>(null);
  const initial = useRef(entry);
  const mounted = useRef(true);
  const [step, setStep] = useState<'offer' | 'account' | 'login' | 'trial'>('offer');
  const [note, setNote] = useState('');
  const [unsavedRecovery, setUnsavedRecovery] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const close = () => { if (unsavedRecovery) setConfirmLeave(true); else closeNow(); };
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
  const view = key ? 'key' : step === 'account' || step === 'login' ? step : busy ? 'waiting' : ready ? 'ready' : unknown ? 'checking'
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
    const releaseScroll = lockBodyScroll();
    if (typeof el?.showModal === 'function') el.showModal();
    else el?.setAttribute('open', '');
    return () => {
      releaseScroll();
      el?.close?.();
      const fallback = origin?.fallback?.isConnected ? origin.fallback : document.querySelector<HTMLElement>('main');
      const focus = origin?.trigger?.isConnected ? origin.trigger : fallback?.querySelector<HTMLElement>('button, input, a') ?? fallback;
      focus?.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); dialog.current?.scrollTo?.(0, 0); }, [view]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { setNote(''); }, [sessionRevision]);
  useEffect(() => { if (confirmLeave && unsavedRecovery) leaveNotice.current?.focus(); }, [confirmLeave, unsavedRecovery]);
  useEffect(() => { if (location.pathname !== initial.current?.pathname) closeNow(); }, [location.pathname, closeNow]);
  useEffect(() => {
    if (accountId && !useEntitlement.getState().loading) void useEntitlement.getState().load();
  }, [accountId]);

  const startTrial = async () => {
    if (useEntitlement.getState().loading) return;
    const owns = captureAccountSessionOwner();
    setNote('');
    const result = await useEntitlement.getState().claimTrial();
    if (mounted.current && owns() && result !== 'ok') setNote(trialNote(result, ru));
  };
  const returnLabel = source === 'lesson' ? ru ? 'Вернуться к заданию' : 'Back to your exercise'
    : source === 'reader' ? ru ? 'Вернуться к чтению' : 'Back to reading'
      : source === 'text' ? ru ? 'Вернуться к тексту' : 'Back to your text'
        : ru ? 'Готово' : 'Done';

  const accountView = view === 'account' || view === 'login';
  return <dialog ref={dialog} aria-labelledby={accountView ? 'access-title' : 'pro-activation-title'} onCancel={e => { e.preventDefault(); close(); }}
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
      {!accountView && <h2 ref={heading} tabIndex={-1} id="pro-activation-title" className="col-span-2 text-[calc(1.5rem*var(--app-text-scale,1))] font-semibold leading-tight tracking-tight outline-none">{title}</h2>}
    </div>
    <div className="space-y-5">
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
      {(view === 'account' || view === 'login') && <AccessFlow initial={view === 'account' ? 'register' : 'login'} signupIntent="trial" onContinue={closeNow} onTrialComplete={plan => { showAccountAccessNotice(plan); closeNow(); }} onRecoveryDraftChange={setUnsavedRecovery} />}
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
          {catalog.state === 'ready' && monthly && catalog.value.available && <p className="text-xs text-muted">{ru ? `Сейчас Pro — ${formatPrice(monthly.priceKopecks)} за ${monthly.days} дней. После пробного периода действуют актуальные на тот момент цены.` : `Pro currently costs ${formatPrice(monthly.priceKopecks)} for ${monthly.days} days. After the trial, the prices in effect at that time apply.`}</p>}
          {catalog.state === 'loading' && <p role="status" className="text-xs text-muted">{ru ? 'Проверяем цену…' : 'Checking the price…'}</p>}
          {catalog.state === 'error' && <div className="text-sm text-muted"><p>{ru ? 'Не удалось проверить цену Pro.' : 'Could not check the Pro price.'}</p><Button className="mt-2 min-h-11" variant="ghost" onClick={retry}>{ru ? 'Повторить загрузку цены' : 'Retry price'}</Button></div>}
        </>}
        {trialAvailable && <ProConditions ru={ru} />}
      </>}
      {note && <p role="alert" className="rounded-sm border border-amber-dim bg-amber-dim/10 p-3 text-sm">{note}</p>}
      {confirmLeave && unsavedRecovery && <div ref={leaveNotice} tabIndex={-1} role="alert" className="access-notice"><p>{ru ? 'Резервные коды ещё не сохранены. Если уйти, их нельзя будет показать снова; новый набор можно выпустить в аккаунте.' : 'Backup codes have not been saved. Leaving hides this set; you can issue a new set in your account.'}</p><div className="mt-3 flex flex-wrap gap-2"><Button variant="ghost" onClick={() => setConfirmLeave(false)}>{ru ? 'Остаться' : 'Stay'}</Button><Button onClick={closeNow}>{ru ? 'Уйти без сохранения' : 'Leave without saving'}</Button></div></div>}
      {view !== 'ready' && <button type="button" className="min-h-11 w-full text-sm text-muted hover:text-content" onClick={close}>{view === 'offer' && !active ? ru ? 'Продолжить бесплатно' : 'Continue free' : returnLabel}</button>}
    </div>
  </dialog>;
}
