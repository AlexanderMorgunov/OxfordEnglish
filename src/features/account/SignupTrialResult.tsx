import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import type { SignupTrialPhase } from './useSignupTrial';

export function SignupTrialResult({
  phase,
  check,
  retry,
  onContinue,
}: {
  phase: SignupTrialPhase;
  check: () => void;
  retry: () => void;
  onContinue: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const waiting = phase === 'pending';
  return (
    <div>
      <p className="access-intro" role="status">
        {waiting
          ? ru
            ? 'Аккаунт создан. Проверяем и подключаем Pro…'
            : 'Account created. Checking and activating Pro…'
          : phase === 'unavailable'
            ? ru
              ? 'Аккаунт создан. Пробный период уже использован или недоступен на этом устройстве. Можно продолжить бесплатно.'
              : 'Account created. The free trial was already used or is unavailable on this device. You can continue free.'
            : phase === 'complete'
              ? ru
                ? 'Ваш доступ к Pro подтверждён.'
                : 'Your Pro access is confirmed.'
              : ru
                ? 'Аккаунт создан. Не удалось подтвердить активацию Pro. Ваш аккаунт сохранён — повторная регистрация не нужна.'
                : 'Account created. Pro activation could not be confirmed. Your account is kept — no need to register again.'}
      </p>
      {phase === 'uncertain' && (
        <Button className="access-primary" onClick={check}>
          {ru ? 'Проверить результат' : 'Check result'}
        </Button>
      )}
      {phase === 'failed' && (
        <Button className="access-primary" onClick={retry}>
          {ru ? 'Повторить активацию Pro' : 'Retry Pro activation'}
        </Button>
      )}
      {!waiting && (
        <button
          type="button"
          className="access-text-button"
          onClick={onContinue}
        >
          {ru ? 'Продолжить бесплатно' : 'Continue free'}
        </button>
      )}
    </div>
  );
}
