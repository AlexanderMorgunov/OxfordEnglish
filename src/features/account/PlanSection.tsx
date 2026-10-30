import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Eyebrow } from '@/shared/ui';
import { planLine, subscriptionState, useEntitlement } from './entitlement';
import { PurchaseActions } from './PurchaseActions';
import { trialNote } from './trialCopy';
import { captureAccountSessionOwner, useAccount } from './store';

export function PlanSection({ ru }: { ru: boolean }) {
  const session = useAccount(s => s.sessionRevision);
  return <PlanSectionBody key={session} ru={ru} />;
}

function PlanSectionBody({ ru }: { ru: boolean }) {
  const entitlement = useEntitlement(s => s.entitlement);
  const loading = useEntitlement(s => s.loading);
  const trialError = useEntitlement(s => s.error);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const state = subscriptionState(entitlement, Date.now());
  const onTrial = async () => {
    if (useEntitlement.getState().loading) return;
    const owns = captureAccountSessionOwner();
    setBusy(true); setNote('');
    const outcome = await useEntitlement.getState().claimTrial();
    if (!owns()) return;
    if (outcome !== 'ok') setNote(trialNote(outcome, ru));
    setBusy(false);
  };
  return <section className="mt-5 space-y-3 border-t border-line pt-4">
    <Eyebrow>{ru ? 'Подписка' : 'Subscription'}</Eyebrow>
    {!entitlement ? <>
      <p role="status" className="text-sm text-muted">{loading ? ru ? 'Проверяем подписку…' : 'Checking your plan…'
        : ru ? 'Не удалось проверить подписку. Проверьте соединение и повторите.' : 'Could not check your plan. Check your connection and retry.'}</p>
      <Button variant="ghost" disabled={loading} onClick={() => void useEntitlement.getState().load()}>{ru ? 'Проверить подписку' : 'Check plan'}</Button>
    </> : <>
      <p className="text-sm">{planLine(entitlement, state, ru)}</p>
      {entitlement.active && entitlement.ai.limit > 0 && <p className="text-xs text-muted">{ru ? `ИИ-запросы: ${entitlement.ai.used} из ${entitlement.ai.limit}` : `AI requests: ${entitlement.ai.used} of ${entitlement.ai.limit}`}</p>}
      {(state === 'expired' || state === 'trial-over') && <p className="text-sm text-muted">{ru ? 'Книги, слова и прогресс сохранены. Pro вернёт доступ к AI и синхронизации.' : 'Your books, words and progress are saved. Pro restores AI and sync.'}</p>}
      {state === 'none' && trialError !== 'trial_already_claimed' && <Button disabled={busy} onClick={() => void onTrial()}>{ru ? 'Попробовать 14 дней бесплатно' : 'Try 14 days free'}</Button>}
    </>}
    {note && <p role="status" className="text-sm text-muted">{note}</p>}
    <PurchaseActions />
    <Link to="/pro" className="inline-flex min-h-11 items-center text-sm text-teal hover:underline">{ru ? 'Что входит в Pro' : "What's in Pro"}</Link>
  </section>;
}
