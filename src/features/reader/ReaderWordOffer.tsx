import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAccount } from '@/features/account/store';
import { useEntitlement, quotaNotice, subscriptionState } from '@/features/account/entitlement';
import { accountsEnabled } from '@/features/account/config';
import { useProActivation } from '@/features/account/proActivation';
import { useBillingCatalog } from '@/features/account/useBillingCatalog';
import { formatPrice } from '@/features/account/billing';
import { upsellTarget } from '@/features/ai/upsell';
import { beginLessonWordReturn, beginWordReturn, type LessonWordTarget } from './word-return';
import type { BookSource } from './chapter-vocabulary';

export function ReaderWordOffer({ word, sentence, source, tokenId, manualDraft, lessonTarget }: {
  word: string; sentence: string; source?: BookSource; tokenId?: string; manualDraft: string | null; lessonTarget?: LessonWordTarget;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const t = (r: string, e: string) => ru ? r : e;
  const { pathname } = useLocation();
  const status = useAccount(s => s.status);
  const entitlement = useEntitlement(s => s.entitlement);
  const error = useEntitlement(s => s.error);
  const loading = useEntitlement(s => s.loading);
  const target = upsellTarget(status, entitlement);
  const state = subscriptionState(entitlement, Date.now());
  const trial = status === 'anonymous' || state === 'none' && error !== 'trial_already_claimed';
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update); window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  const { catalog, monthly, retry } = useBillingCatalog(online && target === 'plans');
  if (!accountsEnabled() || target === 'none') return null;
  const open = (intent: 'trial' | 'purchase', trigger: HTMLElement) => {
    if (!online) return;
    if (!lessonTarget && (!source || !tokenId)) { useProActivation.getState().open({ source: 'reader', excerpt: sentence }, pathname, trigger); return; }
    const returnId = lessonTarget ? beginLessonWordReturn({ pathname, ...lessonTarget, word, manualDraft })
      : beginWordReturn({ pathname, bookKey: source!.bookKey, chapterId: source!.chapterId, tokenId: tokenId!, word, manualDraft });
    useProActivation.getState().openReaderWord({ kind: 'reader-word', word, returnId, intent, pathname,
      task: { source: 'reader', excerpt: sentence }, trigger, fallback: trigger.closest('main') });
  };
  return <section className="rdh-offer" aria-label={t('Помощь ИИ', 'AI help')}>
    <div className="rdh-offer-heading"><AppIcon name="pro" /><strong>{t('Уточним перевод с ИИ?', 'Find the meaning with AI?')}</strong></div>
    {!online ? <p role="status">{t('Сейчас нет сети. ИИ заработает после подключения. Своё значение можно сохранить ниже.', 'You are offline. AI will be available when connected. You can save your own meaning below.')}</p>
      : target === 'unknown' ? <><p role="status">{t('Не удалось проверить доступ к ИИ. Ваш Pro может быть активен.', 'AI access could not be checked. Your Pro may already be active.')}</p><Button disabled={loading} onClick={() => void useEntitlement.getState().load()}>{t('Проверить доступ', 'Check access')}</Button></>
        : target !== 'plans' ? <><p role="alert">{quotaNotice(entitlement, ru)?.text ?? t('Лимит ИИ израсходован.', 'AI budget is spent.')}</p>{target !== 'quota-resets' && <button type="button" className="access-text-button" onClick={e => open('purchase', e.currentTarget)}>{target === 'quota-final' ? t('Посмотреть Pro', 'See Pro') : t('Продлить Pro', 'Extend Pro')}</button>}</>
          : <>
            <p>{t('ИИ учтёт предложение и поможет понять значение слова в нём.', 'AI uses the sentence to explain the meaning of the word.')}</p>
            {trial ? <><Button className="min-h-12 w-full" onClick={e => open('trial', e.currentTarget)}>{t('Попробовать 14 дней бесплатно', 'Try 14 days free')}</Button><p className="rdh-note">{t('Без карты и автоматических списаний', 'No card or automatic charges')}</p></>
              : <p>{t('Пробный период уже использован. Перевод с ИИ доступен с Pro.', 'Your trial has been used. AI translation is available with Pro.')}</p>}
            <button type="button" className="access-text-button" onClick={e => open('purchase', e.currentTarget)}>{trial ? t('Или подключить Pro', 'Or get Pro') : t('Подключить Pro', 'Get Pro')}{catalog.state === 'ready' && catalog.value.available && monthly ? ` · ${formatPrice(monthly.priceKopecks)} / ${monthly.days} ${t('дней', 'days')}` : ''}</button>
            {catalog.state === 'error' && <button type="button" className="access-text-button" onClick={retry}>{t('Повторить загрузку цены', 'Retry price')}</button>}
          </>}
  </section>;
}
