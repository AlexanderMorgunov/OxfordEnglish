import { useEffect, useState } from 'react';
import { billingPlans } from './api';
import { accountsEnabled } from './config';
import type { BillingPlans } from './contract';

type Catalog = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: BillingPlans };

export function useBillingCatalog(enabled = true) {
  const [catalog, setCatalog] = useState<Catalog>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled || !accountsEnabled()) { setCatalog({ state: 'ready', value: { available: false, plans: [] } }); return; }
    let alive = true;
    const controller = new AbortController();
    setCatalog(current => current.state === 'ready' ? current : { state: 'loading' });
    void billingPlans(controller.signal).then(value => {
      if (alive) setCatalog({ state: 'ready', value });
    }, () => { if (alive) setCatalog({ state: 'error' }); });
    return () => { alive = false; controller.abort(); };
  }, [attempt, enabled]);
  useEffect(() => {
    if (!enabled || !accountsEnabled()) return;
    const refresh = () => { if (!document.hidden) setAttempt(a => a + 1); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => { clearInterval(interval); window.removeEventListener('focus', refresh); window.removeEventListener('online', refresh); document.removeEventListener('visibilitychange', refresh); };
  }, [enabled]);
  useEffect(() => {
    if (catalog.state !== 'ready' || !catalog.value.validUntil || !catalog.value.serverTime) return;
    const delay = Math.max(0, catalog.value.validUntil - catalog.value.serverTime);
    const timer = window.setTimeout(() => setAttempt(a => a + 1), Math.min(delay + 50, 2_147_000_000));
    return () => clearTimeout(timer);
  }, [catalog]);
  const monthly = catalog.state === 'ready' ? catalog.value.plans.find(p => p.code === 'pro_month') : undefined;
  return { catalog, monthly, canBuy: catalog.state === 'ready' && catalog.value.available && !!monthly,
    retry: () => setAttempt(a => a + 1) };
}
