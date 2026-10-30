import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Button, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useProActivation } from '@/features/account/proActivation';
import { useAccount } from '@/features/account/store';
import { accountsEnabled } from '@/features/account/config';
import { useEntitlement, planLine, subscriptionState } from '@/features/account/entitlement';
import { useBillingCatalog } from '@/features/account/useBillingCatalog';
import { formatPrice } from '@/features/account/billing';
import { ProDemo } from '@/features/account/ProDemo';
import type { ProDemoKind } from '@/features/account/ProDemo';
import { ProConditions } from '@/features/account/ProConditions';
import { PurchaseActions } from '@/features/account/PurchaseActions';
import { track } from '@/features/analytics/analytics';
import { BackToReader } from '@/features/reader/BackToReader';

export function ProPage() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const { pathname } = useLocation();
  const status = useAccount(s => s.status);
  const entitlement = useEntitlement(s => s.entitlement);
  const loading = useEntitlement(s => s.loading);
  const trialError = useEntitlement(s => s.error);
  const state = subscriptionState(entitlement, Date.now());
  const unknown = status === 'authenticated' && state === 'unknown';
  const ended = state === 'expired' || state === 'trial-over';
  const trialAvailable = status === 'anonymous' || state === 'none' && trialError !== 'trial_already_claimed';
  const accessLabel = trialAvailable ? ru ? '14 дней бесплатно ↓' : '14 days free ↓'
    : state === 'expired' ? ru ? 'Продлить Pro ↓' : 'Renew Pro ↓'
      : state === 'trial-over' || state === 'none' ? ru ? 'Оформить Pro ↓' : 'Get Pro ↓'
        : unknown ? ru ? 'Проверить подписку ↓' : 'Check subscription ↓'
          : ru ? 'Моя подписка ↓' : 'My subscription ↓';
  const { catalog, monthly, canBuy, retry } = useBillingCatalog(trialAvailable);
  useEffect(() => { void track('pro_page_view'); }, []);
  const features: { kind: ProDemoKind; icon: string; title: string; text: string }[] = [
    { kind: 'lesson', icon: 'ui/ai', title: ru ? 'Разобраться в ошибке' : 'Understand your mistake', text: ru ? 'Понятное объяснение прямо в задании.' : 'A clear explanation right in your exercise.' },
    { kind: 'text', icon: 'ui/translate', title: ru ? 'AI-перевод с учётом контекста' : 'AI translation with context', text: ru ? 'AI учитывает смысл фраз и контекст — в книгах и при переводе вашего текста.' : 'AI takes phrases and context into account, in books and your own text.' },
    { kind: 'reader', icon: 'nav/library', title: ru ? 'Понять предложение в книге' : 'Understand a sentence in your book', text: ru ? 'Разбор грамматики и упрощение сложных предложений прямо в читалке.' : 'Grammar explanations and simpler wording, right in the reader.' },
    { kind: 'sync', icon: 'nav/progress', title: ru ? 'Продолжить на другом устройстве' : 'Continue on another device', text: ru ? 'Книги, словарь и прогресс — с собой.' : 'Take your books, vocabulary and progress with you.' },
  ];
  return <article className="mx-auto w-full max-w-prose">
    <BackToReader />
    <Eyebrow className="mb-3">DayEnglish Pro</Eyebrow>
    <h1 className="mb-4 text-2xl font-bold leading-tight tracking-tight sm:text-3xl">{ru ? 'Помощь там, где трудно' : 'Help when you get stuck'}</h1>
    <p className="mb-3 text-base leading-relaxed text-muted">{ru ? 'Учитесь бесплатно. Подключайте Pro, когда нужны объяснения AI и занятия на нескольких устройствах.' : 'Learn for free. Add Pro when you need AI explanations and learning across devices.'}</p>
    <a href="#pro-access" className="mb-6 inline-flex min-h-11 items-center text-sm text-teal underline">{accessLabel}</a>
    <div className="mb-7 space-y-4">
      {features.map(f => <section key={f.kind} className="space-y-4 rounded-lg border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-start gap-4">
          <PixelImage src={`/assets/pixel/${f.icon}.png`} alt="" className="mt-1 h-8 w-8 shrink-0" />
          <div className="min-w-0"><h2 className="mb-1 text-base font-semibold">{f.title}</h2><p className="text-sm leading-relaxed text-muted">{f.text}</p></div>
        </div>
        <ProDemo kind={f.kind} ru={ru} />
      </section>)}
    </div>
    <section id="pro-access" className="scroll-mt-5 space-y-4 rounded-xl border border-violet-dim bg-violet-dim/10 p-5 sm:p-6" aria-label={ru ? 'Подключение Pro' : 'Get Pro'}>
      {trialAvailable ? <>
        <div><h2 className="text-2xl font-semibold">{ru ? '14 дней бесплатно' : '14 days free'}</h2><p className="mt-1 text-sm text-muted">{ru ? 'Без карты и автоматических списаний' : 'No card or automatic charges'}</p></div>
        {canBuy && monthly && <p className="text-sm text-muted">{ru ? `Затем — ${formatPrice(monthly.priceKopecks)} за ${monthly.days} дней, если захотите продолжить.` : `Then ${formatPrice(monthly.priceKopecks)} for ${monthly.days} days, if you choose to continue.`}</p>}
        {catalog.state === 'loading' && <p role="status" className="text-sm text-muted">{ru ? 'Проверяем актуальную цену…' : 'Checking the current price…'}</p>}
        {catalog.state === 'error' && <div className="space-y-2 text-sm text-muted"><p role="status">{ru ? 'Цена не загрузилась. Проверьте соединение и повторите.' : 'The price did not load. Check your connection and retry.'}</p><Button variant="ghost" onClick={retry}>{ru ? 'Повторить загрузку цены' : 'Retry price'}</Button></div>}
        {catalog.state === 'ready' && !canBuy && <p className="text-sm text-muted">{ru ? 'Оплата пока недоступна.' : 'Payments are currently unavailable.'}</p>}
        {accountsEnabled() && <Button className="min-h-12 w-full" onClick={e => useProActivation.getState().open({ source: 'pro' }, pathname, e.currentTarget)}>{ru ? 'Попробовать 14 дней' : 'Try 14 days'}</Button>}
        <ProConditions ru={ru} />
      </> : <>
        {unknown ? <>
          <p role="status" className="text-sm text-muted">{loading ? ru ? 'Проверяем подписку…' : 'Checking your subscription…' : ru ? 'Не удалось проверить подписку. Попробуйте ещё раз.' : 'Could not check your subscription. Please retry.'}</p>
          <Button variant="ghost" disabled={loading} onClick={() => void useEntitlement.getState().load()}>{ru ? 'Проверить подписку' : 'Check subscription'}</Button>
        </> : entitlement && <>
          <h2 className="text-lg font-semibold">{planLine(entitlement, state, ru)}</h2>
          {ended && <p className="text-sm text-muted">{ru ? 'Книги, слова и прогресс сохранены. Подключите Pro, чтобы снова пользоваться AI и синхронизацией.' : 'Your books, words and progress are saved. Get Pro to use AI and sync again.'}</p>}
          {state === 'pro' && <p className="text-sm text-muted">{ru ? 'Продлить можно заранее. Оплаченные дни добавятся к текущему сроку.' : 'You can renew early. The paid days are added to your current period.'}</p>}
        </>}
        <PurchaseActions />
      </>}
    </section>
    <section className="mt-8 space-y-3">
      <h2 className="text-xl font-semibold">{ru ? 'Бесплатная учёба остаётся' : 'Free learning stays free'}</h2>
      <p className="text-sm leading-relaxed text-muted">{ru ? 'Курс, грамматика, чтение своих книг, перевод слов, словарь и интервальные повторения доступны без подписки и регистрации.' : 'The course, grammar, your own books, word lookup, vocabulary and spaced repetition remain available without a subscription or registration.'}</p>
      <details className="border-t border-line py-3 text-sm leading-relaxed text-muted">
        <summary className="min-h-11 cursor-pointer text-content">{ru ? 'Что будет, когда Pro закончится' : 'What happens when Pro ends'}</summary>
        <p>{ru ? 'Книги и прогресс останутся на устройстве. Сохранённую облачную копию можно загрузить. Новые изменения снова начнут отправляться в облако после продления Pro.' : 'Your books and progress stay on your device. You can still download the saved cloud copy. New changes will sync to the cloud again after you renew Pro.'}</p>
      </details>
    </section>
    <p className="mt-6 border-t border-line pt-5 text-xs leading-relaxed text-muted">
      <Link to="/terms" className="text-teal underline">{ru ? 'Условия и публичная оферта' : 'Terms and public offer'}</Link>{' · '}
      <Link to="/privacy" className="text-teal underline">{ru ? 'Конфиденциальность' : 'Privacy'}</Link>
    </p>
  </article>;
}
