import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { currentWordReturn, discardWordReturn, prepareWordCheckout, readyWordReturn } from '@/features/reader/word-return';
import { AccessFlow } from './AccessFlow';
import { PurchaseActions } from './PurchaseActions';
import { useEntitlement, hasManagedAi, subscriptionState } from './entitlement';
import { useAccount } from './store';
import { useSignupTrial } from './useSignupTrial';
import { useProActivation, type ReaderWordActivation } from './proActivation';

export function ReaderWordActivationDialog({ entry }: { entry: ReaderWordActivation }) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const t = (r: string, e: string) => ru ? r : e;
  const { pathname } = useLocation();
  const status = useAccount(s => s.status);
  const entitlement = useEntitlement(s => s.entitlement);
  const loading = useEntitlement(s => s.loading);
  const error = useEntitlement(s => s.error);
  const [step, setStep] = useState<'trial' | 'purchase' | 'register' | 'login'>(entry.intent);
  const [unsaved, setUnsaved] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const leaveNotice = useRef<HTMLDivElement>(null);
  const trial = useSignupTrial();
  const state = subscriptionState(entitlement, Date.now());
  const trialAvailable = status === 'anonymous' || state === 'none' && error !== 'trial_already_claimed' && trial.phase !== 'unavailable';
  const finish = () => { readyWordReturn(entry.returnId); useProActivation.getState().close(); };
  const close = () => { if (unsaved) setLeaving(true); else finish(); };
  useEffect(() => {
    if (pathname === entry.pathname) return;
    if (currentWordReturn()?.id === entry.returnId) discardWordReturn();
    useProActivation.getState().close();
  }, [pathname, entry.pathname, entry.returnId]);
  useEffect(() => { if (leaving) leaveNotice.current?.focus(); }, [leaving]);
  useEffect(() => {
    if (step === 'purchase' && !unsaved && hasManagedAi(entitlement)) {
      readyWordReturn(entry.returnId);
      useProActivation.getState().close();
    }
  }, [step, unsaved, entitlement, entry.returnId]);

  const uncertain = trial.phase === 'uncertain';
  const pending = trial.phase === 'pending' || loading;
  const form = step === 'register' || step === 'login';
  return <Dialog title={form ? t('Доступ к аккаунту', 'Account access') : step === 'purchase' ? t('Перевод с DayEnglish Pro', 'Translate with DayEnglish Pro') : t('Попробовать перевод с ИИ', 'Try AI translation')} onClose={close}
    footer={<button type="button" className="access-text-button" onClick={close}>{t('Вернуться к слову', 'Back to the word')}</button>}>
    <div className="space-y-4">
      <div className="rdh-offer-heading"><AppIcon name="pro" /><span>DayEnglish Pro</span></div>
      <p className="rdh-word" lang="en">{entry.word}</p>
      <blockquote className="rdh-quote rdh-offer-quote" lang="en" tabIndex={0} aria-label={t('Исходное предложение', 'Original sentence')}>{entry.task.excerpt}</blockquote>
      {form ? <AccessFlow initial={step === 'login' ? 'login' : 'register'} signupIntent={step === 'register' ? 'trial' : 'account'}
        onRecoveryDraftChange={setUnsaved} onTrialComplete={finish} onContinue={finish} onCancel={close} />
        : step === 'purchase' ? <PurchaseActions initialPlan="pro_month" onRecoveryDraftChange={setUnsaved} onCancelAccess={close} beforeCheckout={() => prepareWordCheckout(entry.returnId)} />
          : <>
            <p>{t('14 дней Pro бесплатно: ИИ подберёт значение слова с учётом предложения. Без карты и автоматических списаний.', '14 days of Pro free: AI finds the meaning that fits this sentence. No card or automatic charges.')}</p>
            <p className="rdh-note">{t('Пробный период доступен один раз. У помощи ИИ есть лимит. Свой перевод и сохранение слова всегда бесплатны.', 'The free trial is available once. AI use is limited. Your own meaning and saving the word are always free.')}</p>
            {status === 'authenticated' && !entitlement ? <>
              <p role="status">{t('Сначала проверим доступ. Если Pro уже есть, повторное подключение не нужно.', 'We will check access first. If you already have Pro, there is no need to activate again.')}</p>
              <Button disabled={pending} onClick={() => void trial.restore(finish)}>{t('Проверить доступ', 'Check access')}</Button>
            </> : trialAvailable ? <>
              {uncertain && <p role="alert">{t('Ответ об активации не получен. Сначала проверьте результат — повторять регистрацию не нужно.', 'Activation could not be confirmed. Check the result first; no new registration is needed.')}</p>}
              {trial.phase === 'failed' && <p role="alert">{t('Пробный период не включился. Можно повторить активацию.', 'The trial did not start. You can retry activation.')}</p>}
              <Button className="min-h-12 w-full" disabled={pending} onClick={() => {
                if (status === 'anonymous') setStep('register');
                else if (uncertain) void trial.check();
                else void trial.start(finish);
              }}>{pending ? t('Проверяем активацию…', 'Checking activation…') : uncertain ? t('Проверить результат', 'Check result') : t('Начать 14 дней и перевести', 'Start 14 days and translate')}</Button>
              {status === 'anonymous' && <button type="button" className="access-text-button" onClick={() => setStep('login')}>{t('Уже есть аккаунт? Войти', 'Already have an account? Sign in')}</button>}
            </> : <p role="status">{t('Пробный период уже использован или недоступен. Можно подключить Pro или сохранить слово бесплатно.', 'The trial was already used or is unavailable. You can get Pro or save the word free.')}</p>}
            <button type="button" className="access-text-button" onClick={() => setStep('purchase')}>{t('Посмотреть сроки и цены Pro', 'See Pro plans and prices')}</button>
          </>}
      {leaving && unsaved && <div ref={leaveNotice} tabIndex={-1} role="alert" className="access-notice"><p>{t('Резервные коды ещё не сохранены. Этот набор нельзя будет показать снова; новый можно выпустить в аккаунте.', 'Backup codes have not been saved. This set cannot be shown again; you can issue a new set in account settings.')}</p><div className="rdh-actions"><Button variant="ghost" onClick={() => setLeaving(false)}>{t('Остаться', 'Stay')}</Button><Button onClick={finish}>{t('Уйти без сохранения', 'Leave without saving')}</Button></div></div>}
    </div>
  </Dialog>;
}
