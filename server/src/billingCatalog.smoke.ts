import assert from 'node:assert/strict';
import { createApp } from './app.js';
import {
  catalogAt,
  CampaignSchema,
  initialCatalogSettings,
  InMemoryBillingCatalogStore,
} from './billingCatalog.js';
import { InMemoryEntitlementStore } from './entitlements.js';
import { resultSignature } from './billing.js';

process.env.ROBOKASSA_LOGIN = 'sale-smoke';
process.env.ROBOKASSA_PASSWORD1 = 'local-fixture-password1';
process.env.ROBOKASSA_PASSWORD2 = 'local-fixture-password2';
process.env.ADMIN_TOKEN = 'local-sale-admin-token-123456';
const initial = initialCatalogSettings();
const campaign = initial.campaign!;
const prices = (at: number) =>
  catalogAt(initial, at, true).plans.map((p) => p.priceKopecks);
assert.deepEqual(prices(campaign.startsAt - 1), [19900, 49900, 149900]);
assert.deepEqual(prices(campaign.startsAt), [15000, 39900, 99000]);
assert.deepEqual(prices(campaign.endsAt - 1), [15000, 39900, 99000]);
assert.deepEqual(prices(campaign.endsAt), [19900, 49900, 149900]);
assert.equal(
  CampaignSchema.safeParse({ ...campaign, endsAt: campaign.startsAt }).success,
  false
);
assert.equal(
  CampaignSchema.safeParse({
    ...campaign,
    prices: { ...campaign.prices, pro_month: 19900 },
  }).success,
  false
);
const now = Date.now();
const store = new InMemoryBillingCatalogStore({
  revision: 0,
  campaign: { ...campaign, startsAt: now - 10000, endsAt: now + 60000 },
});
const ent = new InMemoryEntitlementStore();
const app = createApp(
  undefined,
  undefined,
  undefined,
  ent,
  undefined,
  undefined,
  undefined,
  undefined,
  undefined,
  store
);
const admin = {
  authorization: `Bearer ${process.env.ADMIN_TOKEN}`,
  'content-type': 'application/json',
};
const send = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  app.request(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
assert.equal((await app.request('/v1/admin/billing')).status, 401);
assert.equal((await send('/v1/admin/billing', initial)).status, 401);
const reg = await send('/v1/auth/register', {
  accountId: 'acc-sale0123456789ab',
  verifier: 'verifier-sale-0123456789',
  deviceName: 'Smoke',
});
assert.equal(reg.status, 200);
const token = ((await reg.json()) as { accessToken: string }).accessToken;
const auth = { authorization: `Bearer ${token}` };
assert.equal(
  (await app.request('/v1/billing/plans')).headers.get('cache-control'),
  'no-store'
);
assert.equal(
  (await send('/v1/billing/checkout', { plan: 'toString' }, auth)).status,
  400
);
assert.equal(
  (
    await send(
      '/v1/billing/checkout',
      { plan: 'pro_year', expectedAmountKopecks: 1 },
      auth
    )
  ).status,
  409
);
assert.equal(
  (
    await send(
      '/v1/billing/checkout',
      { plan: 'pro_month', expectedAmountKopecks: -1 },
      auth
    )
  ).status,
  400
);
const orders: Array<{
  grantToken: string;
  invoiceId: string;
  amountKopecks: number;
  paymentUrl: string;
}> = [];
for (const [plan, amount] of [
  ['pro_month', 15000],
  ['pro_quarter', 39900],
  ['pro_year', 99000],
] as const) {
  const res = await send(
    '/v1/billing/checkout',
    { plan, expectedAmountKopecks: amount },
    auth
  );
  assert.equal(res.status, 200);
  const order = (await res.json()) as (typeof orders)[number];
  orders.push(order);
  const link = new URL(order.paymentUrl);
  assert.equal(Number(link.searchParams.get('OutSum')) * 100, amount);
  const receipt = JSON.parse(
    decodeURIComponent(link.searchParams.get('Receipt')!)
  );
  assert.equal(receipt.items[0].sum * 100, amount);
}
const concurrent = await Promise.all([
  send('/v1/admin/billing', { revision: 0, campaign: null }, admin),
  send('/v1/admin/billing', { revision: 0, campaign: null }, admin),
]);
assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 409]);
const normal = (await (await app.request('/v1/billing/plans')).json()) as {
  campaign: unknown;
  plans: Array<{ priceKopecks: number; days: number }>;
};
assert.equal(normal.campaign, null);
assert.deepEqual(
  normal.plans.map((p) => [p.days, p.priceKopecks]),
  [
    [30, 19900],
    [90, 49900],
    [365, 149900],
  ]
);
assert.equal(
  (
    await send(
      '/v1/billing/checkout',
      { plan: 'pro_year', expectedAmountKopecks: 99000 },
      auth
    )
  ).status,
  409
);
for (const order of orders) {
  const sum = (order.amountKopecks / 100).toFixed(2);
  const fields: Record<string, string> = {
    OutSum: sum,
    InvId: order.invoiceId,
    SignatureValue: resultSignature(
      sum,
      order.invoiceId,
      process.env.ROBOKASSA_PASSWORD2!,
      'md5'
    ),
  };
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(
      (
        await app.request('/v1/billing/robokassa/result', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams(fields).toString(),
        })
      ).status,
      200
    );
  for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(
      (
        await send(
          '/v1/entitlement/redeem',
          { grantToken: order.grantToken },
          auth
        )
      ).status,
      200
    );
}
assert.ok(
  Math.abs(
    ((await ent.get('acc-sale0123456789ab'))!.paidUntil! - Date.now()) /
      86400000 -
      485
  ) < 0.01
);
const future = {
  ...campaign,
  id: 'next-sale',
  startsAt: now + 86400000,
  endsAt: now + 172800000,
};
assert.equal(
  (await send('/v1/admin/billing', { revision: 1, campaign: future }, admin))
    .status,
  200
);
assert.equal(
  (
    await send(
      '/v1/admin/billing',
      {
        revision: 2,
        campaign: { ...future, prices: { ...campaign.prices, pro_year: 0 } },
      },
      admin
    )
  ).status,
  400
);
console.log(
  'PASS: boundaries, permanent plans, price consent, receipt, admin auth/CAS, delayed callback, redemption replay, renewal and scheduled campaign.'
);
