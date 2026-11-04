import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { accountsEnabled } from './config';
import {
  accessAvailability,
  accessCapabilities,
  accessStatus,
} from './access-api';
import { ApiFailure } from './api';
import type {
  AccessAccount,
  AccessPurpose,
  AccessResult,
} from './access-contract';
import {
  normalizeLogin,
  normalizePassword,
  passwordLength,
  passwordPolicyError,
  validLogin,
} from './access-policy';
import { AccessField, AccessIcon } from './AccessFields';
import { accessErrorText } from './access-errors';
import { captureAccountSessionOwner, useAccount } from './store';
import { deriveCredentials } from './keys';
import { useAccessOperation } from './useAccessOperation';
import './access.css';
import { useSignupTrial } from './useSignupTrial';
import { SignupTrialResult } from './SignupTrialResult';
import type { Entitlement } from './contract';
import { planLine, subscriptionState } from './entitlement';
import { useRecoveryDraft } from './recovery-draft';

type Stage =
  | 'register'
  | 'login'
  | 'legacy'
  | 'recover'
  | 'legacy-recover'
  | 'reset'
  | 'reset-done'
  | 'lost'
  | 'welcome'
  | 'manage'
  | 'reauth'
  | 'attach'
  | 'password'
  | 'enroll'
  | 'codes'
  | 'replace'
  | 'signup-trial';
type Enrollment = NonNullable<AccessResult['enrollment']>;
type Proof = { token: string; expiresAt: number };
type Bundle = { codes: string[]; revision: string; replaced: boolean };

export function AccessFlow({
  initial = 'register',
  onContinue,
  onCancel,
  onRecoveryDraftChange,
  signupIntent = 'account',
  onTrialComplete,
  onTrialStart,
  onOwnerChange,
}: {
  initial?: 'register' | 'login' | 'manage';
  onContinue?: (kind?: 'register' | 'login' | 'free') => void;
  onCancel?: () => void;
  onRecoveryDraftChange?: (unsaved: boolean) => void;
  signupIntent?: 'account' | 'trial';
  onTrialComplete?: (plan: Entitlement) => void;
  onTrialStart?: () => void;
  onOwnerChange?: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const status = useAccount((s) => s.status);
  const revision = useAccount((s) => s.sessionRevision);
  const legacyBusy = useAccount((s) => s.busy);
  const [stage, setStage] = useState<Stage>(initial);
  const [signupTrial, setSignupTrial] = useState(false);
  const [signupPlan, setSignupPlan] = useState<Entitlement | null>(null);
  const [welcomeKind, setWelcomeKind] = useState<'register' | 'login'>('login');
  const trial = useSignupTrial();
  const [capability, setCapability] = useState<
    'loading' | 'ready' | 'unavailable' | 'error'
  >('loading');
  const [capabilityAttempt, setCapabilityAttempt] = useState(0);
  const [account, setAccount] = useState<AccessAccount | null>(null);
  const [statusError, setStatusError] = useState(false);
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [credential, setCredential] = useState('');
  const [code, setCode] = useState('');
  const [proof, setProof] = useState<Proof | null>(null);
  const [purpose, setPurpose] = useState<AccessPurpose>('setup');
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [saved, setSaved] = useState(false);
  useRecoveryDraft(Boolean(bundle && !saved));
  const [leavingCodes, setLeavingCodes] = useState(false);
  const [copyNotice, setCopyNotice] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<
    'idle' | 'loading' | 'free' | 'taken' | 'error'
  >('idle');
  const [resetLogin, setResetLogin] = useState<string | null>(null);
  const [recoverWith, setRecoverWith] = useState<'totp' | 'backup'>('totp');
  const heading = useRef<HTMLHeadingElement>(null);
  const previousScreen = useRef('');
  const errorSummary = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const secretsOwner = useRef(captureAccountSessionOwner());
  const statusRequest = useRef(0);
  const clearSensitive = () => {
    trial.reset();
    setSignupTrial(false);
    setSignupPlan(null);
    setPassword('');
    setRepeat('');
    setCredential('');
    setCode('');
    setProof(null);
    setEnrollment(null);
    setBundle(null);
    setAccount(null);
    setLogin('');
    secretsOwner.current = captureAccountSessionOwner();
    setStage(
      useAccount.getState().status === 'authenticated' ? 'manage' : 'login'
    );
    onOwnerChange?.();
  };
  const op = useAccessOperation(clearSensitive);
  const clearSensitiveRef = useRef(clearSensitive);
  clearSensitiveRef.current = clearSensitive;
  const t = (r: string, e: string) => (ru ? r : e);
  const blocked =
    op.busy || op.uncertain || legacyBusy || trial.phase === 'pending';
  const loadStatus = async () => {
    const owns = captureAccountSessionOwner();
    const request = ++statusRequest.current;
    setStatusError(false);
    try {
      const token = await useAccount.getState().getAccessToken();
      if (!token) throw new Error('No session');
      const value = await accessStatus(token);
      if (mounted.current && owns() && request === statusRequest.current) {
        setAccount(value);
        secretsOwner.current = owns;
      }
    } catch {
      if (mounted.current && owns() && request === statusRequest.current)
        setStatusError(true);
    }
  };
  useEffect(() => {
    mounted.current = true;
    const hide = () => {
      mounted.current = false;
      flushSync(() => clearSensitiveRef.current());
    };
    const show = (event: PageTransitionEvent) => {
      mounted.current = true;
      if (event.persisted && useAccount.getState().status === 'authenticated')
        void loadStatus();
    };
    window.addEventListener('pagehide', hide);
    window.addEventListener('pageshow', show);
    return () => {
      mounted.current = false;
      window.removeEventListener('pagehide', hide);
      window.removeEventListener('pageshow', show);
    };
  }, []);
  useEffect(() => {
    const unsaved = Boolean(bundle && !saved);
    onRecoveryDraftChange?.(unsaved);
    const leave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    if (unsaved) window.addEventListener('beforeunload', leave);
    return () => {
      window.removeEventListener('beforeunload', leave);
      onRecoveryDraftChange?.(false);
    };
  }, [bundle, saved, onRecoveryDraftChange]);
  useEffect(() => {
    const abort = new AbortController();
    if (!accountsEnabled()) {
      setCapability('unavailable');
      return;
    }
    setCapability('loading');
    void accessCapabilities(abort.signal)
      .then((value) => {
        if (!abort.signal.aborted)
          setCapability(value.enabled ? 'ready' : 'unavailable');
      })
      .catch((error) => {
        if (!abort.signal.aborted)
          setCapability(
            error instanceof ApiFailure && error.status === 404
              ? 'unavailable'
              : 'error'
          );
      });
    return () => abort.abort();
  }, [capabilityAttempt]);
  useEffect(() => {
    if (status === 'authenticated' && capability === 'ready') void loadStatus();
    else setAccount(null);
    // Status is scoped to the session; token rotations do not change the owner.
  }, [revision, capability, status]);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    const screen = `${stage}:${op.uncertain}`;
    if (previousScreen.current && previousScreen.current !== screen)
      heading.current?.scrollIntoView?.({ block: 'start' });
    previousScreen.current = screen;
    setCopyNotice('');
  }, [stage, op.uncertain]);
  useEffect(() => {
    if (
      stage !== 'codes' ||
      !bundle ||
      !account?.codesRevision ||
      account.codesRevision === bundle.revision
    )
      return;
    setBundle(null);
    setStage('manage');
    setErrors({ codes: accessErrorText('codes_changed', ru) });
  }, [account, bundle, stage, ru]);
  useEffect(() => {
    if (stage !== 'codes') return;
    const focus = () => void loadStatus();
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [stage]);
  useEffect(() => {
    if (
      (!['register', 'attach'].includes(stage) &&
        !(stage === 'reset' && resetLogin === null)) ||
      !validLogin(login) ||
      capability !== 'ready'
    ) {
      setAvailability('idle');
      return;
    }
    const abort = new AbortController();
    setAvailability('loading');
    const timer = setTimeout(() => {
      void accessAvailability(normalizeLogin(login), abort.signal)
        .then((value) => {
          if (!abort.signal.aborted)
            setAvailability(value.available ? 'free' : 'taken');
        })
        .catch(() => {
          if (!abort.signal.aborted) setAvailability('error');
        });
    }, 450);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [login, stage, resetLogin, capability]);

  const go = (next: Stage) => {
    if (blocked) return;
    setErrors({});
    op.clearError();
    setCode('');
    setCredential('');
    setRepeat('');
    setPassword('');
    if (!['reset', 'attach', 'replace'].includes(next)) setProof(null);
    setStage(next);
  };
  const change =
    (name: string, setter: (v: string) => void) => (value: string) => {
      setter(value);
      setErrors((current) => {
        const next = { ...current };
        delete next[name];
        return next;
      });
      op.clearError();
    };
  const validate = (fields: Record<string, string | null>) => {
    const next = Object.fromEntries(
      Object.entries(fields).filter((entry): entry is [string, string] =>
        Boolean(entry[1])
      )
    );
    setErrors(next);
    if (Object.keys(next).length) {
      queueMicrotask(() => errorSummary.current?.focus());
      return false;
    }
    return true;
  };
  const loginError = () =>
    validLogin(login) ? null : accessErrorText('login_invalid', ru);
  const passwordError = () => {
    const error = passwordPolicyError(password);
    return error ? accessErrorText(error, ru) : null;
  };
  const accountResult = (result: AccessResult) => {
    statusRequest.current += 1;
    if (result.account) setAccount(result.account);
    secretsOwner.current = captureAccountSessionOwner();
  };
  const receiveCodes = (result: AccessResult, replaced: boolean) => {
    accountResult(result);
    if (!result.codes || !result.account?.codesRevision)
      throw new Error('Incomplete codes result');
    setBundle({
      codes: result.codes,
      revision: result.account.codesRevision,
      replaced,
    });
    setEnrollment(null);
    setCode('');
    setProof(null);
    setSaved(false);
    setLeavingCodes(false);
    setStage('codes');
  };
  const reauthenticate = async () => {
    if (
      !validate({
        credential: credential
          ? null
          : t(
              'Введите пароль или прежний ключ.',
              'Enter your password or legacy key.'
            ),
      })
    )
      return;
    let value = credential;
    if (!account?.login) {
      try {
        const derived = await deriveCredentials(credential.trim());
        if (derived.accountId !== useAccount.getState().accountId)
          throw new Error('Wrong owner');
        value = derived.verifier;
      } catch {
        setErrors({
          credential: t(
            'Этот ключ не относится к вашему аккаунту.',
            'This key does not belong to your account.'
          ),
        });
        return;
      }
    }
    await op.run(
      {
        action: 'reauth',
        credential: value,
        credentialType: account?.login ? 'password' : 'key',
        purpose,
      },
      async (result) => {
        setCredential('');
        if (!result.proof || !result.expiresAt)
          throw new Error('Incomplete proof result');
        if (purpose === 'setup') {
          setProof({ token: result.proof, expiresAt: result.expiresAt });
          setStage('enroll');
          // A separate explicit click starts enrollment, so the first operation can settle.
        } else {
          setProof({ token: result.proof, expiresAt: result.expiresAt });
          setStage(
            purpose === 'attach'
              ? 'attach'
              : purpose === 'codes'
                ? 'replace'
                : 'password'
          );
        }
      }
    );
  };
  const beginReauth = (value: AccessPurpose) => {
    setPurpose(value);
    go('reauth');
  };
  const submit = (work: () => Promise<void>) => (event: FormEvent) => {
    event.preventDefault();
    if (!blocked) void work();
  };
  const primary = (
    label: string,
    props: { onClick?: () => void; type?: 'submit'; disabled?: boolean } = {}
  ) => (
    <Button
      className="access-primary"
      disabled={blocked || props.disabled}
      {...props}
    >
      {op.busy ? t('Подождите…', 'Please wait…') : label}
      <AccessIcon name="arrow" />
    </Button>
  );
  const textButton = (label: string, click: () => void) => (
    <button
      type="button"
      className="access-text-button"
      disabled={blocked}
      onClick={click}
    >
      {label}
    </button>
  );
  const back = () =>
    textButton(t('← К аккаунту', '← Back to account'), () => go('manage'));
  const fieldError = (field: string) =>
    errors[field] ??
    ((field === 'login' &&
      ['login_invalid', 'login_taken'].includes(op.error)) ||
    (field === 'password' && op.error.startsWith('password_'))
      ? accessErrorText(op.error, ru)
      : undefined);
  const loginField = (checking = false) => (
    <>
      <AccessField
        ru={ru}
        label={t('Логин', 'Username')}
        name="username"
        autoComplete="username"
        autoCapitalize="none"
        spellCheck={false}
        value={login}
        readOnly={blocked}
        onChange={(e) => change('login', setLogin)(e.target.value)}
        error={fieldError('login')}
        hint={
          checking
            ? t(
                '4–24 символа: латинские буквы, цифры и _. Начните с буквы.',
                '4–24 letters, digits or underscores. Start with a letter.'
              )
            : undefined
        }
      />
      {checking && (
        <p
          className={`access-availability access-availability-${availability}`}
          role="status"
        >
          {availability === 'loading'
            ? t('Проверяем логин…', 'Checking username…')
            : availability === 'free'
              ? t('Логин свободен', 'Username is available')
              : availability === 'taken'
                ? t(
                    'Логин занят — выберите другой',
                    'Username is taken — choose another'
                  )
                : availability === 'error'
                  ? t(
                      'Проверим доступность при сохранении',
                      'Availability will be checked when saving'
                    )
                  : ''}
        </p>
      )}
    </>
  );
  const passwordFields = (confirmation = false) => (
    <>
      <AccessField
        ru={ru}
        label={t(
          confirmation ? 'Новый пароль' : 'Пароль',
          confirmation ? 'New password' : 'Password'
        )}
        name="password"
        password
        autoComplete="new-password"
        value={password}
        readOnly={blocked}
        onChange={(e) => change('password', setPassword)(e.target.value)}
        error={fieldError('password')}
        hint={t(
          'От 15 до 128 символов. Подойдёт длинная фраза с пробелами.',
          '15–128 characters. A long phrase with spaces works well.'
        )}
      />
      <p className="access-count">{passwordLength(password)} / 128</p>
      {confirmation && (
        <AccessField
          ru={ru}
          label={t('Повторите пароль', 'Repeat password')}
          name="confirm-password"
          password
          autoComplete="new-password"
          value={repeat}
          readOnly={blocked}
          onChange={(e) => change('repeat', setRepeat)(e.target.value)}
          error={fieldError('repeat')}
        />
      )}
    </>
  );
  const title: Record<Stage, string> = {
    register: t('Создайте свой аккаунт', 'Create your account'),
    login: t('С возвращением', 'Welcome back'),
    legacy: t('Войти по старому ключу', 'Sign in with a legacy key'),
    recover: t('Восстановить доступ', 'Recover access'),
    'legacy-recover': t(
      'Восстановить старый аккаунт',
      'Recover a legacy account'
    ),
    reset: t(
      resetLogin ? 'Придумайте новый пароль' : 'Добавьте логин и пароль',
      resetLogin ? 'Choose a new password' : 'Add username and password'
    ),
    'reset-done': t('Пароль сохранён', 'Password saved'),
    lost: t('Нет доступа к кодам?', 'No access to your codes?'),
    welcome: t('Вы в своём аккаунте', 'You are signed in'),
    manage: t('Доступ к аккаунту', 'Account access'),
    reauth: t('Подтвердите доступ', 'Verify access'),
    attach: t('Подключите логин и пароль', 'Add username and password'),
    password: t('Сменить пароль', 'Change password'),
    enroll: t('Подключите приложение', 'Connect your authenticator'),
    codes: t('Сохраните резервные коды', 'Save your backup codes'),
    replace: t('Выпустить новые коды?', 'Issue new codes?'),
    'signup-trial': t('Аккаунт готов', 'Account ready'),
  };
  const submitAccess = async (
    chooseTrial = signupIntent === 'trial' || signupTrial
  ) => {
    if (
      !validate({
        login: loginError(),
        password:
          stage === 'register'
            ? passwordError()
            : password
              ? null
              : t('Введите пароль.', 'Enter your password.'),
      })
    )
      return;
    const action = stage === 'register' ? 'register' : 'login';
    await op.run(
      {
        action,
        login: normalizeLogin(login),
        password: normalizePassword(password),
        deviceId: useAccount.getState().deviceId,
      },
      async (result) => {
        accountResult(result);
        setPassword('');
        setWelcomeKind(action);
        if (action === 'register' && chooseTrial) {
          setStage('signup-trial');
          onTrialStart?.();
          await trial.start((plan) => {
            setSignupPlan(plan);
            onTrialComplete?.(plan);
          });
        } else setStage('welcome');
      }
    );
  };
  const renderStage = (): ReactNode => {
    if (stage === 'signup-trial')
      return (
        <>
          {signupPlan ? (
            <>
              <p role="status" className="access-notice">
                {planLine(
                  signupPlan,
                  subscriptionState(signupPlan, Date.now()),
                  ru
                )}
              </p>
              {primary(t('Продолжить', 'Continue'), {
                onClick: () => onContinue ? onContinue() : go('manage'),
              })}
            </>
          ) : (
            <SignupTrialResult
              phase={trial.phase}
              check={() => void trial.check()}
              retry={() => void trial.retry()}
              onContinue={() => onContinue ? onContinue('free') : go('manage')}
            />
          )}
        </>
      );
    if (stage === 'register' || stage === 'login')
      return (
        <>
          <div className="access-modes">
            {(['register', 'login'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                disabled={blocked}
                aria-current={stage === mode ? 'page' : undefined}
                onClick={() => go(mode)}
              >
                {mode === 'register'
                  ? t('Создать аккаунт', 'Create account')
                  : t('Войти', 'Sign in')}
              </button>
            ))}
          </div>
          <p className="access-intro">
            {stage === 'register'
              ? t(
                  'Один аккаунт для ваших книг, словаря и прогресса. Без почты и телефона.',
                  'One account for your books, vocabulary and progress. No email or phone.'
                )
              : t(
                  'Введите логин и пароль, чтобы продолжить с того же места.',
                  'Enter your username and password to pick up where you left off.'
                )}
          </p>
          <form onSubmit={submit(() => submitAccess())}>
            {loginField(stage === 'register')}
            {stage === 'register' ? (
              passwordFields()
            ) : (
              <AccessField
                ru={ru}
                label={t('Пароль', 'Password')}
                name="password"
                password
                autoComplete="current-password"
                value={password}
                readOnly={blocked}
                onChange={(e) =>
                  change('password', setPassword)(e.target.value)
                }
                error={fieldError('password')}
              />
            )}
            {stage === 'login' &&
              textButton(t('Забыли пароль?', 'Forgot password?'), () =>
                go('recover')
              )}
            {stage === 'register' &&
              (signupIntent === 'trial' ? (
                <p className="access-trial-terms">
                  {t(
                    '14 дней бесплатно. Без карты и автоматических списаний.',
                    '14 days free. No card or automatic charges.'
                  )}
                </p>
              ) : (
                <label className="access-checkbox access-trial-choice">
                  <input
                    name="signup-trial"
                    type="checkbox"
                    checked={signupTrial}
                    disabled={blocked}
                    onChange={(e) => setSignupTrial(e.target.checked)}
                  />
                  <span>
                    <span>
                      {t(
                        'Начать 14 дней Pro бесплатно',
                        'Start 14 days of Pro free'
                      )}
                    </span>
                    <small>
                      {t(
                        'Без карты. После пробного периода ничего не спишется.',
                        'No card. Nothing is charged after the free trial.'
                      )}
                    </small>
                  </span>
                </label>
              ))}
            {primary(
              stage === 'register'
                ? signupIntent === 'trial' || signupTrial
                  ? t(
                      'Создать аккаунт и попробовать Pro',
                      'Create account and try Pro'
                    )
                  : t('Создать аккаунт', 'Create account')
                : t('Войти', 'Sign in'),
              { type: 'submit' }
            )}
          </form>
          {stage === 'register' &&
            signupIntent === 'trial' &&
            textButton(
              t('Создать аккаунт без Pro', 'Create account without Pro'),
              () => void submitAccess(false)
            )}
          {stage === 'register' && (
            <p className="access-hint">
              {t(
                'Создавая аккаунт, вы принимаете ',
                'By creating an account, you accept our '
              )}
              <Link to="/privacy">
                {t('политику конфиденциальности', 'privacy policy')}
              </Link>
              .
            </p>
          )}
          <div className="access-divider" />
          {textButton(
            t('Войти по старому ключу', 'Sign in with a legacy key'),
            () => go('legacy')
          )}
        </>
      );
    if (stage === 'legacy')
      return (
        <>
          <p className="access-intro">
            {t(
              'Прежний ключ продолжает работать. После входа можно добавить удобный логин и пароль к этому же аккаунту.',
              'Your legacy key still works. After signing in, add a username and password to the same account.'
            )}
          </p>
          <form
            onSubmit={submit(async () => {
              if (
                !validate({
                  credential: credential.trim()
                    ? null
                    : t('Вставьте сохранённый ключ.', 'Paste your saved key.'),
                })
              )
                return;
              const owns = captureAccountSessionOwner();
              try {
                await useAccount
                  .getState()
                  .linkWithKey(
                    credential.trim(),
                    () => mounted.current && owns()
                  );
                if (
                  mounted.current &&
                  useAccount.getState().status === 'authenticated'
                ) {
                  op.adoptOwner();
                  secretsOwner.current = captureAccountSessionOwner();
                  setCredential('');
                  setWelcomeKind('login');
                  setStage('welcome');
                  void loadStatus();
                }
              } catch {
                if (mounted.current && owns())
                  setErrors({
                    credential: t(
                      'Вход не выполнен. Проверьте ключ и соединение.',
                      'Sign-in failed. Check the key and your connection.'
                    ),
                  });
              }
            })}
          >
            <AccessField
              ru={ru}
              label={t('Сохранённый ключ', 'Saved key')}
              name="legacy-key"
              password
              autoComplete="off"
              value={credential}
              onChange={(e) =>
                change('credential', setCredential)(e.target.value)
              }
              error={errors.credential}
            />
            {primary(t('Войти по ключу', 'Sign in with key'), {
              type: 'submit',
            })}
          </form>
          {textButton(
            t(
              'Нет ключа, но настроено восстановление',
              'No key, but recovery is set up'
            ),
            () => go('legacy-recover')
          )}
          {textButton(t('← Вход по логину', '← Sign in with username'), () =>
            go('login')
          )}
        </>
      );
    if (stage === 'welcome')
      return (
        <>
          <div className="access-success">
            <AccessIcon name="check" />
          </div>
          <p className="access-intro">
            {welcomeKind === 'register' && (
              <span className="block">
                {t(
                  'Аккаунт создан. Пробный период не запускался; Pro можно подключить позже.',
                  'Account created. The free trial has not started; you can try Pro later.'
                )}
              </span>
            )}
            {account?.login
              ? `@${account.login}`
              : t(
                  'Ваши книги, слова, прогресс и подписка остаются в этом аккаунте.',
                  'Your books, words, progress and subscription stay with this account.'
                )}
          </p>
          {primary(t('Продолжить', 'Continue'), {
            onClick: () => {
              if (onContinue) onContinue(welcomeKind);
              else go('manage');
            },
          })}
          {account &&
            !account.login &&
            textButton(
              t('Подключить логин и пароль', 'Add username and password'),
              () => beginReauth('attach')
            )}
          {account &&
            !account.recovery &&
            textButton(t('Настроить восстановление', 'Set up recovery'), () =>
              beginReauth('setup')
            )}
          <p className="access-hint">
            {t(
              'Восстановление можно настроить позже в аккаунте. Оно поможет, если вы забудете пароль.',
              'You can set up recovery later in your account. It helps if you forget your password.'
            )}
          </p>
        </>
      );
    if (stage === 'manage')
      return status !== 'authenticated' ? (
        <>
          {textButton(t('Войти', 'Sign in'), () => go('login'))}
          {textButton(t('Создать аккаунт', 'Create account'), () =>
            go('register')
          )}
        </>
      ) : (
        <>
          {account ? (
            <>
              <p className="access-account-name">
                {account.login
                  ? `@${account.login}`
                  : t('Аккаунт с прежним ключом', 'Legacy key account')}
              </p>
              {!account.login && (
                <div className="access-notice">
                  <AccessIcon name="key" />
                  <p>
                    {t(
                      'Добавьте логин и пароль к этому же аккаунту. Книги, слова, Pro и прогресс сохранятся.',
                      'Add a username and password to this account. Your books, vocabulary, Pro and progress stay with you.'
                    )}
                  </p>
                  {textButton(
                    t('Подключить логин и пароль', 'Add username and password'),
                    () => beginReauth('attach')
                  )}
                </div>
              )}
              <div className="access-setting-row">
                <AccessIcon name="key" />
                <div>
                  <h3>{t('Пароль', 'Password')}</h3>
                  <p>
                    {account.login
                      ? t(
                          'Вход по логину и паролю',
                          'Sign in with username and password'
                        )
                      : t(
                          'Вход по прежнему ключу',
                          'Sign in with your legacy key'
                        )}
                  </p>
                </div>
                {account.login &&
                  textButton(t('Изменить', 'Change'), () =>
                    beginReauth('password')
                  )}
              </div>
              <div className="access-setting-row">
                <AccessIcon name="shield" />
                <div>
                  <h3>{t('Восстановление', 'Recovery')}</h3>
                  <p>
                    {account.recovery
                      ? t('Приложение подключено', 'Authenticator connected')
                      : t('Пока не настроено', 'Not set up yet')}
                  </p>
                </div>
                {!account.recovery &&
                  textButton(t('Настроить', 'Set up'), () =>
                    beginReauth('setup')
                  )}
              </div>
              {account.recovery && (
                <div className="access-setting-row">
                  <AccessIcon name="check" />
                  <div>
                    <h3>{t('Резервные коды', 'Backup codes')}</h3>
                    <p>
                      {t(
                        `Осталось ${account.backupRemaining} из ${account.backupTotal}`,
                        `${account.backupRemaining} of ${account.backupTotal} remaining`
                      )}
                    </p>
                  </div>
                  {textButton(t('Новый набор', 'New set'), () =>
                    beginReauth('codes')
                  )}
                </div>
              )}
              {!account.codesAcknowledged && account.recovery && (
                <p className="access-notice">
                  {t(
                    'Сохранение последнего набора не подтверждено. Если коды потеряны, выпустите новый набор.',
                    'Saving the latest codes has not been confirmed. If they were lost, issue a new set.'
                  )}
                </p>
              )}
              {account.legacyKey && account.login && (
                <p className="access-hint">
                  {t(
                    'Прежний ключ тоже работает. Восстановление пароля отзовёт этот ключ и старые входы.',
                    'Your legacy key also works. Password recovery revokes that key and previous sessions.'
                  )}
                </p>
              )}
            </>
          ) : (
            <p role="status" className="access-intro">
              {statusError
                ? t(
                    'Не удалось загрузить состояние доступа.',
                    'Could not load account access.'
                  )
                : t('Загружаем состояние доступа…', 'Loading account access…')}
            </p>
          )}
          {textButton(
            t('Обновить состояние', 'Refresh status'),
            () => void loadStatus()
          )}
        </>
      );
    if (stage === 'reauth')
      return (
        <>
          {back()}
          <p className="access-intro">
            {t(
              'Проверим, что это ваш аккаунт, прежде чем изменять доступ.',
              'Verify this is your account before changing access.'
            )}
          </p>
          <form onSubmit={submit(reauthenticate)}>
            {account?.login && (
              <input
                type="hidden"
                autoComplete="username"
                name="username"
                value={account.login}
              />
            )}
            <AccessField
              ru={ru}
              label={
                account?.login
                  ? t('Текущий пароль', 'Current password')
                  : t('Прежний ключ', 'Legacy key')
              }
              name="credential"
              password
              autoComplete={account?.login ? 'current-password' : 'off'}
              value={credential}
              readOnly={blocked}
              onChange={(e) =>
                change('credential', setCredential)(e.target.value)
              }
              error={errors.credential}
            />
            {primary(t('Подтвердить доступ', 'Verify access'), {
              type: 'submit',
            })}
          </form>
          {textButton(
            t('Не помню пароль или ключ', 'I forgot my password or key'),
            () => go(account?.login ? 'recover' : 'legacy-recover')
          )}
        </>
      );
    if (stage === 'attach' || stage === 'password' || stage === 'reset')
      return (
        <>
          {stage !== 'reset'
            ? back()
            : textButton(t('Отмена восстановления', 'Cancel recovery'), () =>
                go('login')
              )}
          <p className="access-intro">
            {stage === 'reset'
              ? t(
                  'После сохранения войдите с новым паролем. Прежние входы и старый ключ перестанут работать.',
                  'After saving, sign in with the new password. Previous sessions and the legacy key will stop working.'
                )
              : stage === 'attach'
                ? t(
                    'Это тот же аккаунт. Прежний ключ продолжит работать.',
                    'This is the same account. Your legacy key will continue to work.'
                  )
                : t(
                    'На этом устройстве вы останетесь в аккаунте. На остальных потребуется войти заново.',
                    'You will stay signed in on this device. Other devices will need to sign in again.'
                  )}
          </p>
          <form
            onSubmit={submit(async () => {
              const needsLogin =
                stage === 'attach' ||
                (stage === 'reset' && resetLogin === null);
              if (
                !validate({
                  login: needsLogin ? loginError() : null,
                  password: passwordError(),
                  repeat:
                    normalizePassword(password) === normalizePassword(repeat)
                      ? null
                      : accessErrorText('password_mismatch', ru),
                })
              )
                return;
              if (!proof || proof.expiresAt <= Date.now()) {
                setErrors({ password: accessErrorText('proof_expired', ru) });
                return;
              }
              await op.run(
                {
                  action: stage === 'password' ? 'change-password' : stage,
                  login: needsLogin
                    ? normalizeLogin(login)
                    : (resetLogin ?? account?.login ?? undefined),
                  password: normalizePassword(password),
                  proof: proof.token,
                },
                (result) => {
                  accountResult(result);
                  setProof(null);
                  setPassword('');
                  setRepeat('');
                  if (stage === 'reset') {
                    setLogin(result.login ?? login);
                    setStage('reset-done');
                  } else setStage('manage');
                }
              );
            })}
          >
            {stage === 'attach' ||
            (stage === 'reset' && resetLogin === null) ? (
              loginField(true)
            ) : (
              <input
                type="hidden"
                autoComplete="username"
                name="username"
                value={resetLogin ?? account?.login ?? ''}
              />
            )}
            {passwordFields(true)}
            {primary(t('Сохранить', 'Save'), { type: 'submit' })}
          </form>
          {textButton(
            t('Подтвердить доступ заново', 'Verify access again'),
            () => {
              if (stage === 'reset')
                go(resetLogin ? 'recover' : 'legacy-recover');
              else beginReauth(stage === 'attach' ? 'attach' : 'password');
            }
          )}
        </>
      );
    if (stage === 'recover' || stage === 'legacy-recover')
      return (
        <>
          <p className="access-intro">
            {t(
              'Почта не нужна. Подтвердите доступ кодом из приложения-аутентификатора или сохранённым резервным кодом.',
              'No email needed. Verify access with an authenticator code or a saved backup code.'
            )}
          </p>
          <form
            onSubmit={submit(async () => {
              if (
                !validate({
                  login: login.trim()
                    ? null
                    : t(
                        'Введите логин или прежнее имя восстановления.',
                        'Enter your username or legacy recovery name.'
                      ),
                  code:
                    recoverWith === 'totp'
                      ? /^\d{6}$/.test(code.replace(/\s/g, ''))
                        ? null
                        : t(
                            'Введите шестизначный код.',
                            'Enter the six-digit code.'
                          )
                      : code.trim()
                        ? null
                        : t('Введите резервный код.', 'Enter a backup code.'),
                })
              )
                return;
              await op.run(
                {
                  action: 'recover',
                  login: login.trim(),
                  code,
                  legacy: stage === 'legacy-recover',
                },
                (result) => {
                  if (!result.proof || !result.expiresAt)
                    throw new Error('Incomplete recovery result');
                  setProof({
                    token: result.proof,
                    expiresAt: result.expiresAt,
                  });
                  setResetLogin(result.login ?? null);
                  setCode('');
                  if (!result.login) setLogin('');
                  setStage('reset');
                }
              );
            })}
          >
            <AccessField
              ru={ru}
              label={
                stage === 'legacy-recover'
                  ? t(
                      'Прежнее имя восстановления или ID',
                      'Legacy recovery name or account ID'
                    )
                  : t('Логин', 'Username')
              }
              name="username"
              autoComplete="username"
              autoCapitalize="none"
              value={login}
              readOnly={blocked}
              onChange={(e) => change('login', setLogin)(e.target.value)}
              error={errors.login}
            />
            <div className="access-modes">
              {(['totp', 'backup'] as const).map((mode) => (
                <button
                  type="button"
                  key={mode}
                  disabled={blocked}
                  aria-current={recoverWith === mode ? 'page' : undefined}
                  onClick={() => {
                    setRecoverWith(mode);
                    setCode('');
                    setErrors({});
                    op.clearError();
                  }}
                >
                  {mode === 'totp'
                    ? t('Приложение', 'Authenticator')
                    : t('Резервный код', 'Backup code')}
                </button>
              ))}
            </div>
            <AccessField
              ru={ru}
              label={t(
                recoverWith === 'totp'
                  ? 'Код из приложения'
                  : 'Одноразовый резервный код',
                recoverWith === 'totp'
                  ? 'Authenticator code'
                  : 'One-use backup code'
              )}
              name="code"
              autoComplete={recoverWith === 'totp' ? 'one-time-code' : 'off'}
              inputMode={recoverWith === 'totp' ? 'numeric' : 'text'}
              value={code}
              readOnly={blocked}
              onChange={(e) => change('code', setCode)(e.target.value)}
              error={errors.code}
            />
            {recoverWith === 'backup' && (
              <p className="access-notice">
                {t(
                  'Код расходуется после успешной проверки, даже если затем отменить смену пароля.',
                  'The code is spent after a successful check, even if you then cancel the password reset.'
                )}
              </p>
            )}
            {primary(t('Продолжить', 'Continue'), { type: 'submit' })}
          </form>
          {textButton(t('Нет доступа к кодам', 'No access to codes'), () =>
            go('lost')
          )}
          {textButton(t('← К входу', '← Back to sign-in'), () =>
            go(stage === 'legacy-recover' ? 'legacy' : 'login')
          )}
        </>
      );
    if (stage === 'lost')
      return (
        <>
          <p className="access-intro">
            {t(
              'Если нет пароля, приложения-аутентификатора и резервных кодов, подтвердить владение аккаунтом не получится. Поддержка не сможет восстановить доступ без подтверждения.',
              'Without a password, authenticator or backup codes, account ownership cannot be verified. Support cannot restore access without proof.'
            )}
          </p>
          {textButton(
            t('У меня сохранился прежний ключ', 'I still have my legacy key'),
            () => go('legacy')
          )}
          {textButton(t('Вернуться к восстановлению', 'Back to recovery'), () =>
            go('recover')
          )}
          <Link className="access-text-button" to="/">
            {t(
              'Продолжить занятия на устройстве',
              'Continue learning on this device'
            )}
          </Link>
        </>
      );
    if (stage === 'reset-done')
      return (
        <>
          <div className="access-success">
            <AccessIcon name="check" />
          </div>
          <p className="access-intro">
            {t(
              'Аккаунт, подписка и данные сохранены. Теперь войдите с новым паролем.',
              'Your account, subscription and data are kept. Now sign in with the new password.'
            )}
          </p>
          {primary(t('Войти с новым паролем', 'Sign in with new password'), {
            onClick: () => go('login'),
          })}
        </>
      );
    if (stage === 'enroll')
      return (
        <>
          <p className="access-intro">
            {t(
              'Приложение поможет восстановить забытый пароль. При обычном входе код не нужен.',
              'The authenticator helps recover a forgotten password. No code is required for ordinary sign-in.'
            )}
          </p>
          {!enrollment ? (
            <>
              {primary(t('Начать подключение', 'Start setup'), {
                onClick: () => {
                  if (proof)
                    void op.run(
                      { action: 'enroll', proof: proof.token },
                      (result) => {
                        if (result.enrollment) {
                          setEnrollment(result.enrollment);
                          setProof(null);
                        }
                      }
                    );
                },
              })}
              {back()}
            </>
          ) : (
            <>
              <div
                className="access-authenticator"
                hidden={!secretsOwner.current()}
              >
                <div className="access-qr">
                  <QRCodeSVG
                    value={enrollment.uri}
                    size={168}
                    bgColor="#fff"
                    fgColor="#222"
                    marginSize={2}
                  />
                  <p>
                    {t('Сканируйте в приложении', 'Scan in your authenticator')}
                  </p>
                </div>
                <div className="access-manual">
                  <h3>{t('На этом телефоне', 'On this phone')}</h3>
                  <p className="access-hint">
                    {t(
                      'Добавьте ключ вручную в Aegis, Google Authenticator или другом приложении. Тип: по времени (TOTP).',
                      'Add this key manually in Aegis, Google Authenticator or another app. Type: time-based (TOTP).'
                    )}
                  </p>
                  <p className="access-secret">{enrollment.secret}</p>
                  {textButton(
                    t('Скопировать ключ', 'Copy key'),
                    () => void copy(enrollment.secret)
                  )}
                </div>
              </div>
              <form
                onSubmit={submit(async () => {
                  if (
                    !validate({
                      code: /^\d{6}$/.test(code.replace(/\s/g, ''))
                        ? null
                        : t(
                            'Введите шестизначный код.',
                            'Enter the six-digit code.'
                          ),
                    })
                  )
                    return;
                  await op.run(
                    { action: 'confirm', enrollmentId: enrollment.id, code },
                    (result) => receiveCodes(result, false)
                  );
                })}
              >
                <AccessField
                  ru={ru}
                  label={t('Код из приложения', 'Authenticator code')}
                  name="code"
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  value={code}
                  readOnly={blocked}
                  onChange={(e) => change('code', setCode)(e.target.value)}
                  error={errors.code}
                />
                {primary(t('Подключить восстановление', 'Enable recovery'), {
                  type: 'submit',
                })}
              </form>
              {textButton(
                t('Отменить подключение', 'Cancel setup'),
                () =>
                  void op.run(
                    {
                      action: 'cancel-enrollment',
                      enrollmentId: enrollment.id,
                    },
                    () => {
                      setEnrollment(null);
                      go('manage');
                    }
                  )
              )}
              {op.error === 'enrollment_expired' &&
                textButton(t('Начать заново', 'Start again'), () => {
                  setEnrollment(null);
                  beginReauth('setup');
                })}
            </>
          )}
        </>
      );
    if (stage === 'replace')
      return (
        <>
          {back()}
          <p className="access-notice">
            {t(
              'Все прежние резервные коды перестанут работать сразу после выпуска. Приложение-аутентификатор останется подключённым.',
              'All previous backup codes stop working as soon as the new set is issued. Your authenticator stays connected.'
            )}
          </p>
          {primary(t('Выпустить 8 новых кодов', 'Issue 8 new codes'), {
            onClick: () => {
              if (proof)
                void op.run({ action: 'codes', proof: proof.token }, (result) =>
                  receiveCodes(result, true)
                );
            },
          })}
        </>
      );
    if (stage === 'codes')
      return (
        <>
          <div className="access-success">
            <AccessIcon name="check" />
          </div>
          <p className="access-intro">
            {bundle?.replaced
              ? t(
                  'Новый набор уже выпущен. Старые коды больше не работают.',
                  'The new set is active. Old codes no longer work.'
                )
              : t(
                  'Приложение уже подключено. Коды помогут, если телефон будет недоступен.',
                  'Your authenticator is connected. These codes help when your phone is unavailable.'
                )}
          </p>
          <p className="access-hint">
            {t(
              'Каждый код одноразовый. После ухода этот набор больше не показывается. Сохраните отдельно от приложения, например в менеджере паролей.',
              'Each code is single-use. This set is hidden after you leave. Keep it separately, for example in a password manager.'
            )}
          </p>
          <ul
            className="access-backup-grid"
            aria-label={t('Резервные коды', 'Backup codes')}
          >
            {secretsOwner.current() &&
              bundle?.codes.map((value) => <li key={value}>{value}</li>)}
          </ul>
          <div className="access-downloads">
            <Button variant="ghost" disabled={blocked} onClick={download}>
              <AccessIcon name="download" />
              {t('Скачать .txt', 'Download .txt')}
            </Button>
            <Button
              variant="ghost"
              disabled={blocked}
              onClick={() => {
                if (secretsOwner.current() && bundle)
                  void copy(bundle.codes.join('\n'));
              }}
            >
              <AccessIcon name="copy" />
              {t('Скопировать', 'Copy')}
            </Button>
          </div>
          <label className="access-checkbox">
            <input
              type="checkbox"
              checked={saved}
              disabled={blocked}
              onChange={(e) => setSaved(e.target.checked)}
            />
            {t(
              'Я сохранил(а) коды в надёжном месте',
              'I have saved the codes somewhere safe'
            )}
          </label>
          {primary(t('Готово', 'Done'), {
            disabled: !saved,
            onClick: () => {
              if (bundle)
                void op.run(
                  { action: 'acknowledge', codesRevision: bundle.revision },
                  (result) => {
                    accountResult(result);
                    setBundle(null);
                    setStage('manage');
                  }
                );
            },
          })}
          {!leavingCodes ? (
            textButton(t('Сохранить позже', 'Save later'), () =>
              setLeavingCodes(true)
            )
          ) : (
            <div className="access-notice">
              <p>
                {t(
                  'После ухода эти коды больше не будут показаны. Восстановление уже работает; новый набор можно выпустить в аккаунте.',
                  'These codes will not be shown after you leave. Recovery is active; you can issue a new set in your account.'
                )}
              </p>
              {textButton(t('Остаться и сохранить', 'Stay and save'), () =>
                setLeavingCodes(false)
              )}
              {textButton(
                t('Уйти без сохранения', 'Leave without saving'),
                () => {
                  setBundle(null);
                  setStage('manage');
                }
              )}
            </div>
          )}
        </>
      );
  };
  async function copy(value: string) {
    const owns = captureAccountSessionOwner();
    try {
      await navigator.clipboard.writeText(value);
      if (mounted.current && owns()) setCopyNotice(t('Скопировано', 'Copied'));
    } catch {
      if (mounted.current && owns())
        setCopyNotice(
          t(
            'Не удалось скопировать. Выделите текст вручную или скачайте файл.',
            'Could not copy. Select the text manually or download the file.'
          )
        );
    }
  }
  function download() {
    if (!bundle || !secretsOwner.current()) return;
    const body = `DayEnglish — ${account?.login ? `@${account.login}` : useAccount.getState().accountId}\n${t('Каждый код одноразовый.', 'Each code is single-use.')}\n\n${bundle.codes.join('\n')}\n`;
    const url = URL.createObjectURL(
      new Blob([body], { type: 'text/plain;charset=utf-8' })
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dayenglish-backup-codes.txt';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <section
      className="access-flow ym-hide-content"
      aria-labelledby="access-title"
    >
      <h2 ref={heading} tabIndex={-1} id="access-title">
        {op.uncertain
          ? t('Проверим результат', 'Check the result')
          : title[stage]}
      </h2>
      {(op.error || Object.keys(errors).length > 0) && (
        <div
          ref={errorSummary}
          tabIndex={-1}
          role="alert"
          className="access-error"
        >
          {op.error && <p>{accessErrorText(op.error, ru)}</p>}
          {Object.entries(errors).map(([field, value]) => (
            <p key={field}>{value}</p>
          ))}
        </div>
      )}
      {capability === 'loading' ? (
        <p role="status">
          {t('Проверяем доступность…', 'Checking availability…')}
        </p>
      ) : capability !== 'ready' ? (
        <>
          <p className="access-intro">
            {accessErrorText('access_unavailable', ru)}
          </p>
          <Button onClick={() => setCapabilityAttempt((v) => v + 1)}>
            {t('Проверить ещё раз', 'Check again')}
          </Button>
          <Link className="access-text-button" to="/settings/account">
            {t('Открыть настройки аккаунта', 'Open account settings')}
          </Link>
        </>
      ) : op.uncertain ? (
        <>
          <p className="access-intro">
            {t(
              'Операция могла сохраниться на сервере. Проверка вернёт тот же результат и не изменит доступ повторно.',
              'The operation may have been saved. Checking returns the same result without changing access again.'
            )}
          </p>
          <Button
            className="access-primary"
            disabled={op.busy}
            onClick={() => void op.reconcile()}
          >
            {t('Проверить результат', 'Check result')}
          </Button>
          {op.error === 'operation_unknown' && (
            <Button
              variant="ghost"
              className="access-primary"
              disabled={op.busy}
              onClick={() => void op.retrySame()}
            >
              {t(
                'Безопасно повторить тот же запрос',
                'Safely resend the same request'
              )}
            </Button>
          )}
        </>
      ) : (
        renderStage()
      )}
      {stage === 'manage' &&
        status === 'authenticated' &&
        capability === 'ready' &&
        onContinue &&
        primary(t('Продолжить', 'Continue'), { onClick: () => onContinue() })}
      <p className="access-hint" role="status">
        {copyNotice}
      </p>
      {onCancel && (
        <button type="button" className="access-text-button" onClick={onCancel}>
          {t('Вернуться к задаче', 'Return to your task')}
        </button>
      )}
      {!blocked &&
        [
          'operation_expired',
          'operation_superseded',
          'recovery_already_enabled',
          'codes_changed',
        ].includes(op.error) &&
        textButton(
          status === 'authenticated'
            ? t('Проверить состояние аккаунта', 'Check account status')
            : t('Войти', 'Sign in'),
          () => {
            setBundle(null);
            setEnrollment(null);
            setProof(null);
            go(status === 'authenticated' ? 'manage' : 'login');
            if (status === 'authenticated') void loadStatus();
          }
        )}
      {op.error === 'account_changed' &&
        textButton(t('Обновить страницу', 'Reload page'), () =>
          window.location.reload()
        )}
    </section>
  );
}
