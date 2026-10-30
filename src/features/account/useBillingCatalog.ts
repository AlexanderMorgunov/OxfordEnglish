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
    setCatalog({ state: 'loading' });
    void billingPlans(controller.signal).then(value => {
      if (alive) setCatalog({ state: 'ready', value });
    }, () => { if (alive) setCatalog({ state: 'error' }); });
    return () => { alive = false; controller.abort(); };
  }, [attempt, enabled]);
  const monthly = catalog.state === 'ready' ? catalog.value.plans.find(p => p.code === 'pro_month') : undefined;
  return { catalog, monthly, canBuy: catalog.state === 'ready' && catalog.value.available && !!monthly,
    retry: () => setAttempt(a => a + 1) };
}
