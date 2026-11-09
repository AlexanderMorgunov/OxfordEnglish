import { useCallback, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button } from '@/shared/ui';
import { useTheme } from '@/features/appearance/themes';
import type { ThemeId } from '@/features/appearance/themes';
import { previewUiTextSize, useAppearance } from '@/features/appearance/store';
import { accountsEnabled } from '@/features/account/config';
import { AccessFlow } from '@/features/account/AccessFlow';
import { useAccount } from '@/features/account/store';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import {
  planLine,
  subscriptionState,
  useEntitlement,
} from '@/features/account/entitlement';
import type { Entitlement } from '@/features/account/contract';
import { useSignupTrial } from '@/features/account/useSignupTrial';
import { showAccountAccessNotice } from '@/features/account/signupNotice';
import { tourOwner } from '@/features/onboarding/memory';
import { initializeNewTheme, saveWelcomePreferences } from './preferences';
import {
  clearTrialPending,
  markWelcomeSeen,
  rememberTrialIntent,
  rememberTrialPending,
  trialIntent,
  trialPending,
  welcomeSeen,
} from './memory';
import { newInstallation, welcomeEntry } from './eligibility';
import { WelcomeDialog } from './WelcomeDialog';
import { WelcomeIntro } from './WelcomeIntro';
import { WelcomeSetup } from './WelcomeSetup';

type Step = 'intro' | 'setup' | 'auth' | 'trial';
export function FirstEntryWelcome() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { pathname, search, state: navigationState } = useLocation();
  const entryAllowed = welcomeEntry(pathname) && !(
    navigationState && typeof navigationState === 'object' &&
    Reflect.get(navigationState, 'fromCapture') === true
  );
  const accountId = useAccount((s) => s.accountId);
  const status = useAccount((s) => s.status);
  const revision = useAccount((s) => s.sessionRevision);
  const plan = useEntitlement((s) => s.entitlement);
  const planError = useEntitlement((s) => s.error);
  const [checking, setChecking] = useState(true);
  const [needsWelcome, setNeedsWelcome] = useState(false);
  const [step, setStep] = useState<Step | null>(null);
  const [theme, setTheme] = useState<ThemeId>(useTheme.getState().theme);
  const [textStep, setTextStep] = useState(useAppearance.getState().textStep);
  const [intent, setIntent] = useState(() => trialIntent(tourOwner()));
  const [planStatus, setPlanStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [planAttempt, setPlanAttempt] = useState(0);
  const [storageError, setStorageError] = useState(false);
  const [sessionOnly, setSessionOnly] = useState(false);
  const [pending, setPending] = useState(() => trialPending(tourOwner()));
  const [unsavedRecovery, setUnsavedRecovery] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [notice, setNotice] = useState('');
  const current = useRef(step);
  current.current = step;
  const restore = useRef(true);
  const returnToTask = useCallback(() => restore.current, []);
  const recoveryWarning = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const newDevice = useRef(false);
  const trial = useSignupTrial();
  const t = (r: string, e: string) => (ru ? r : e);
  const state = subscriptionState(plan, Date.now());
  const active = state === 'pro' || state === 'trial';
  const trialReady =
    accountsEnabled() &&
    (status === 'anonymous' ||
      (planStatus === 'ready' &&
        state === 'none' &&
        planError !== 'trial_already_claimed'));
  const wantsTrial = intent && trialReady;
  const openNow = step !== null;

  const close = (returnToTask = true) => {
    if (!current.current) return;
    restore.current = returnToTask;
    current.current = null;
    setStep(null);
    useTheme.getState().cancel();
    previewUiTextSize(useAppearance.getState().textStep);
    setConfirmLeave(false);
    setUnsavedRecovery(false);
    trial.reset();
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const dismiss = () => {
    if (unsavedRecovery) {
      setConfirmLeave(true);
      return;
    }
    markWelcomeSeen();
    close();
  };
  const open = (next: Step = 'intro') => {
    if (current.current) return;
    restore.current = true;
    setTheme(useTheme.getState().theme);
    setTextStep(useAppearance.getState().textStep);
    setIntent(trialIntent(tourOwner()));
    setStorageError(false);
    setSessionOnly(false);
    setNotice('');
    trial.reset();
    current.current = next;
    setStep(next);
  };
  const openRef = useRef(open);
  openRef.current = open;
  useEffect(() => {
    let alive = true;
    const owns = captureDataScope();
    void newInstallation().then((value) => {
      if (alive) {
        newDevice.current = value;
        setNeedsWelcome(welcomeSeen() === false && owns());
        setChecking(false);
      }
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!needsWelcome || !entryAllowed || step) return;
    const attempt = () => {
      if (current.current) return;
      if (welcomeSeen() !== false) {
        setNeedsWelcome(false);
        return;
      }
      if (
        document.hidden ||
        document.activeElement?.matches(
          'input,textarea,select,[contenteditable=true]'
        )
      )
        return;
      if (
        [
          ...document.querySelectorAll<HTMLElement>(
            'dialog[open],[role="dialog"]'
          ),
        ].some((el) => el.getClientRects().length)
      )
        return;
      if (newDevice.current) initializeNewTheme();
      setNeedsWelcome(false);
      openRef.current();
    };
    const timer = window.setTimeout(attempt, 150);
    const observer = new MutationObserver(attempt);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['open'],
    });
    document.addEventListener('focusout', attempt);
    document.addEventListener('visibilitychange', attempt);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      document.removeEventListener('focusout', attempt);
      document.removeEventListener('visibilitychange', attempt);
    };
  }, [needsWelcome, pathname, entryAllowed, step]);
  useEffect(() => {
    if (!openNow || status !== 'authenticated') return;
    let alive = true;
    setPlanStatus('loading');
    void useEntitlement
      .getState()
      .load()
      .then((value) => {
        if (alive) setPlanStatus(value ? 'ready' : 'error');
      });
    return () => {
      alive = false;
    };
  }, [openNow, accountId, revision, status, planAttempt]);
  useEffect(() => {
    if (confirmLeave) recoveryWarning.current?.focus();
  }, [confirmLeave]);
  useEffect(() => {
    setPending(trialPending(tourOwner()));
  }, [accountId, revision, step]);
  useEffect(() => {
    if (trial.phase === 'unavailable') {
      clearTrialPending(tourOwner());
      setPending(false);
    }
  }, [trial.phase]);
  useEffect(() => {
    mounted.current = true;
    const stop = () => {
      setNeedsWelcome(false);
      setNotice('');
      closeRef.current(false);
    };
    const unsubscribe = subscribeDataScope(() => {
      if (current.current !== 'auth') stop();
    });
    const storage = (event: StorageEvent) => {
      if (event.key === 'oxford-account' || event.key === null) stop();
    };
    const hide = () => {
      flushSync(stop);
    };
    window.addEventListener('storage', storage);
    window.addEventListener('pagehide', hide);
    return () => {
      mounted.current = false;
      unsubscribe();
      window.removeEventListener('storage', storage);
      window.removeEventListener('pagehide', hide);
    };
  }, []);
  const previousRoute = useRef(pathname + search);
  useEffect(() => {
    if (previousRoute.current !== pathname + search) closeRef.current(false);
    previousRoute.current = pathname + search;
  }, [pathname, search]);
  useEffect(
    () => () => {
      if (!current.current) return;
      useTheme.getState().cancel();
      previewUiTextSize(useAppearance.getState().textStep);
    },
    []
  );

  const chooseIntent = (value: boolean) => {
    rememberTrialIntent(tourOwner(), value);
    setIntent(value);
  };
  const complete = (confirmed: Entitlement) => {
    if (!mounted.current || !current.current) return;
    clearTrialPending(tourOwner());
    setPending(false);
    showAccountAccessNotice(confirmed);
    close();
  };
  const begin = (withTrial: boolean, temporary = false) => {
    if (!saveWelcomePreferences(theme, textStep, temporary)) {
      setStorageError(true);
      return;
    }
    setStorageError(false);
    setSessionOnly(temporary);
    if (!withTrial) {
      setNotice(
        temporary
          ? t(
              'Оформление применено только в этом окне.',
              'Appearance applied for this session only.'
            )
          : t('Оформление сохранено.', 'Appearance saved.')
      );
      close();
    } else if (status === 'anonymous') {
      current.current = 'auth';
      setStep('auth');
    } else {
      if (trialPending(tourOwner())) {
        setPending(true);
        current.current = 'trial';
        setStep('trial');
        return;
      }
      rememberTrialPending(tourOwner());
      setPending(true);
      current.current = 'trial';
      setStep('trial');
      void trial.start(complete);
    }
  };
  const continueAccount = (kind?: 'register' | 'login' | 'free') => {
    if (kind === 'login') {
      setIntent(trialIntent(tourOwner()));
      current.current = 'setup';
      setStep('setup');
      setPlanAttempt((n) => n + 1);
    } else {
      chooseIntent(false);
      if (useEntitlement.getState().error === 'trial_already_claimed') {
        clearTrialPending(tourOwner());
        setPending(false);
      }
      setNotice(
        t(
          'Аккаунт готов. Можно продолжать бесплатно.',
          'Your account is ready. Continue free.'
        )
      );
      close();
    }
  };
  const title =
    step === 'intro'
      ? t('Английский в вашем ритме.', 'English at your own pace.')
      : step === 'setup'
        ? t('Пусть будет по-вашему.', 'Make it your own.')
        : step === 'auth'
          ? t('Ваш аккаунт', 'Your account')
          : t('Пробный Pro', 'Free Pro trial');
  const footer =
    step === 'intro' ? (
      <>
        <button type="button" className="fw-quiet" onClick={dismiss}>
          {t('Начать сразу', 'Start now')}
        </button>
        <Button onClick={() => setStep('setup')}>
          {t('Настроить под себя', 'Make it yours')}
        </Button>
      </>
    ) : step === 'setup' ? (
      <>
        <button
          type="button"
          className="fw-quiet"
          onClick={() => setStep('intro')}
        >
          {t('Назад', 'Back')}
        </button>
        <Button onClick={() => begin(wantsTrial)}>
          {storageError
            ? t('Повторить сохранение', 'Retry saving')
            : wantsTrial
              ? status === 'anonymous'
                ? t('Продолжить с Pro', 'Continue with Pro')
                : t('Начать с 14 днями Pro', 'Start with 14 days of Pro')
              : t('Сохранить и начать', 'Save and start')}
        </Button>
        {wantsTrial && (
          <button
            type="button"
            className="fw-quiet fw-free"
            onClick={() => {
              chooseIntent(false);
              begin(false);
            }}
          >
            {t('Начать без Pro', 'Start without Pro')}
          </button>
        )}
        {wantsTrial && (
          <p id="welcome-trial-conditions" className="fw-conditions">
            {t(
              '14 дней бесплатно. Без карты и автосписаний.',
              '14 days free. No card or automatic charges.'
            )}
          </p>
        )}
      </>
    ) : (
      <>
        {step === 'auth' && (
          <button
            type="button"
            className="fw-quiet"
            onClick={() => {
              if (unsavedRecovery) {
                setConfirmLeave(true);
                return;
              }
              current.current = 'setup';
              setStep('setup');
            }}
          >
            {t('Назад к оформлению', 'Back to appearance')}
          </button>
        )}
        <button type="button" className="fw-quiet" onClick={dismiss}>
          {step === 'auth'
            ? t('Вернуться к задаче', 'Return to your task')
            : t('Продолжить бесплатно', 'Continue free')}
        </button>
      </>
    );

  return (
    <>
      {(checking || (needsWelcome && entryAllowed)) && (
        <span data-welcome-pending="true" hidden />
      )}
      {notice && (
        <p className="app-container fw-notice" role="status">
          {notice}
        </p>
      )}
      {pending && !step && status === 'authenticated' && (
        <aside className="app-container fw-pending">
          <p>
            {t(
              'Нужно проверить результат активации Pro. Повторная регистрация не нужна.',
              'Check the result of your Pro activation. No need to register again.'
            )}
          </p>
          <Button variant="ghost" onClick={() => open('trial')}>
            {t('Проверить активацию Pro', 'Check Pro activation')}
          </Button>
        </aside>
      )}
      {step && (
        <WelcomeDialog
          title={title}
          step={step}
          ru={ru}
          close={dismiss}
          returnToTask={returnToTask}
          footer={footer}
        >
          {step === 'intro' && <WelcomeIntro ru={ru} />}
          {step === 'setup' && (
            <>
              <WelcomeSetup
                ru={ru}
                theme={theme}
                textStep={textStep}
                chooseTheme={(value) => {
                  setTheme(value);
                  useTheme.getState().preview(value);
                }}
                chooseSize={(value) => {
                  setTextStep(value);
                  previewUiTextSize(value);
                }}
              />
              {trialReady ? (
                <label className="fw-trial">
                  <input
                    type="checkbox"
                    checked={intent}
                    aria-describedby={
                      wantsTrial ? 'welcome-trial-conditions' : undefined
                    }
                    onChange={(event) => chooseIntent(event.target.checked)}
                  />
                  <span>
                    <strong>
                      {t('14 дней Pro бесплатно', '14 days of Pro free')}{' '}
                      <b>Pro</b>
                    </strong>
                    <span>
                      {t('ИИ-помощь и синхронизация.', 'AI help and sync.')}{' '}
                      {status === 'anonymous' &&
                        t(
                          'Понадобится бесплатный аккаунт.',
                          'A free account is required.'
                        )}
                    </span>
                    <small>
                      {t(
                        'После — бесплатный режим.',
                        'Then continue on the free plan.'
                      )}
                    </small>
                  </span>
                </label>
              ) : (
                <div className="fw-access" role="status">
                  {active && plan ? (
                    <>
                      <strong>{planLine(plan, state, ru)}</strong>
                      <p>
                        {t(
                          'Сохраним доступ и прежний срок.',
                          'Your access and existing expiry stay the same.'
                        )}
                      </p>
                    </>
                  ) : status === 'authenticated' && planStatus !== 'ready' ? (
                    <>
                      <p>
                        {planStatus === 'loading'
                          ? t('Проверяем доступ к Pro…', 'Checking Pro access…')
                          : t(
                              'Не удалось проверить подписку. Можно продолжить бесплатно.',
                              'Could not check your plan. You can continue free.'
                            )}
                      </p>
                      {planStatus === 'error' && (
                        <Button
                          variant="ghost"
                          onClick={() => setPlanAttempt((n) => n + 1)}
                        >
                          {t('Проверить подписку', 'Check plan')}
                        </Button>
                      )}
                    </>
                  ) : (
                    <>
                      <strong>
                        {t(
                          'Пробный период недоступен',
                          'Free trial unavailable'
                        )}
                      </strong>
                      <p>
                        {t(
                          'Уроки, словарь и базовое чтение доступны бесплатно. Подключить Pro можно позже.',
                          'Lessons, vocabulary and basic reading are free. You can get Pro later.'
                        )}
                      </p>
                    </>
                  )}
                </div>
              )}
              {storageError && (
                <div className="fw-error" role="alert">
                  <p>
                    {t(
                      'Не удалось сохранить оформление. Повторите или продолжите только в этом окне.',
                      'Could not save your appearance. Retry or continue for this session only.'
                    )}
                  </p>
                  <Button
                    variant="ghost"
                    onClick={() => begin(wantsTrial, true)}
                  >
                    {t(
                      'Продолжить только в этом окне',
                      'Continue for this session only'
                    )}
                  </Button>
                </div>
              )}
            </>
          )}
          {step === 'auth' && (
            <>
              <AccessFlow
                signupIntent="trial"
                onContinue={continueAccount}
                onTrialComplete={complete}
                onRecoveryDraftChange={setUnsavedRecovery}
                onOwnerChange={() => close(false)}
                onTrialStart={() => {
                  rememberTrialIntent(tourOwner(), intent);
                  rememberTrialPending(tourOwner());
                  setPending(true);
                }}
              />
              {sessionOnly && (
                <p className="fw-access">
                  {t(
                    'Оформление применено только в этом окне.',
                    'Appearance applied for this session only.'
                  )}
                </p>
              )}
            </>
          )}
          {step === 'trial' && (
            <div className="fw-trial-result">
              <p role="status">
                {trial.phase === 'pending'
                  ? t('Проверяем активацию Pro…', 'Checking Pro activation…')
                  : trial.phase === 'unavailable'
                    ? t(
                        'Пробный период уже использован или недоступен на этом устройстве. Аккаунт сохранён.',
                        'The trial was used or is unavailable on this device. Your account is kept.'
                      )
                    : t(
                        'Аккаунт сохранён. Проверим, был ли включён Pro, прежде чем что-либо повторять.',
                        'Your account is kept. Check whether Pro was activated before retrying.'
                      )}
              </p>
              {(trial.phase === 'idle' || trial.phase === 'uncertain') && (
                <Button onClick={() => void trial.restore(complete)}>
                  {t('Проверить результат', 'Check result')}
                </Button>
              )}
              {trial.phase === 'failed' && (
                <Button onClick={() => void trial.retry()}>
                  {t('Повторить активацию Pro', 'Retry Pro activation')}
                </Button>
              )}
            </div>
          )}
          {confirmLeave && (
            <div
              ref={recoveryWarning}
              tabIndex={-1}
              className="fw-error"
              role="alert"
            >
              <p>
                {t(
                  'Резервные коды ещё не сохранены. Если уйти, этот набор нельзя будет показать снова.',
                  'Your backup codes have not been saved. Leaving hides this set.'
                )}
              </p>
              <Button variant="ghost" onClick={() => setConfirmLeave(false)}>
                {t('Остаться', 'Stay')}
              </Button>
              <Button onClick={() => close()}>
                {t('Уйти без сохранения', 'Leave without saving')}
              </Button>
            </div>
          )}
        </WelcomeDialog>
      )}
    </>
  );
}
