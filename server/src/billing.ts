/**
 * Robokassa checkout core — pure functions over strings. No I/O, no clock, no store.
 *
 * The whole integration hangs on one thing: the signature string must be assembled in exactly the
 * documented order, with the right password, hashed with the algorithm configured in the merchant
 * panel. Everything here is written against https://docs.robokassa.ru/ru/pay-interface and
 * .../notifications-and-redirects rather than from memory, because a wrong-by-one signature fails
 * identically to a wrong password and there is no error that tells them apart.
 *
 *   checkout link  MerchantLogin:OutSum:InvId:Пароль#1
 *   ResultURL      OutSum:InvId:Пароль#2
 *
 * We deliberately send NO `Shp_` custom parameters and no `Receipt`: both change the signature string,
 * both are the usual source of mismatch, and neither is needed — the callback identifies our row by
 * `InvId`, which Robokassa always echoes back.
 *
 * PII firewall (docs/backend-v1-design.md §Privacy): no account id, no e-mail, nothing account-shaped
 * ever goes into the payment request. Robokassa learns an invoice number and an amount, and our own
 * grants table stores only a hash of the buying account. Our database cannot answer "who paid" — but
 * `payment_ref` IS a join key into Robokassa's records, which can.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ROBOKASSA_CHECKOUT_URL = 'https://auth.robokassa.ru/Merchant/Index.aspx';
/** Charging a child payment against a parent invoice. Production only — Robokassa has no test mode
 *  for this endpoint — and the monthly charge job that will use it is a separate slice. */
export const ROBOKASSA_RECURRING_URL = 'https://auth.robokassa.ru/Merchant/Recurring';

/** Merchant-panel setting, not a constant: the hash the shop is configured for must match what we send,
 *  so it is read from config rather than hardcoded. MD5 is Robokassa's default. */
export type HashAlgo = 'md5' | 'sha1' | 'sha256' | 'sha384' | 'sha512';
const ALGOS: readonly HashAlgo[] = ['md5', 'sha1', 'sha256', 'sha384', 'sha512'];
export const isHashAlgo = (v: string): v is HashAlgo => (ALGOS as readonly string[]).includes(v);

export type PlanCode = 'pro_month';

export type PlanSpec = {
  code: PlanCode;
  days: number;
  /** Kopecks, so the amount never rides on a float. */
  priceKopecks: number;
  /** Goes to Robokassa as `Description` and shows on the payer's receipt. Max 100 chars. */
  title: string;
  /**
   * The line on the FISCAL receipt, which is not the same string as `title`. Max 128 chars and, per the
   * docs, no special characters — so no em dash, which `title` has. A wrong name here is not a bug we
   * would see: the signature still verifies and every test passes, and it only shows up in the ЛКК.
   */
  receiptName: string;
};

/**
 * The price is the one from docs/monetization-analysis.md §"Почему 199, а не 100" — worst-case token
 * cost is ~15% of it, and the figure has to absorb acquiring and store commission as well.
 *
 * A catalog rather than a constant because a yearly plan is a one-entry change once its price is
 * settled; nothing downstream reads a hardcoded amount.
 */
export const PLANS: Record<PlanCode, PlanSpec> = {
  pro_month: {
    code: 'pro_month',
    days: 30,
    priceKopecks: 19900,
    title: 'DayEnglish Pro — 1 месяц',
    receiptName: 'DayEnglish Pro на 1 месяц',
  },
};

export const isPlanCode = (v: string): v is PlanCode => v in PLANS;

/** Robokassa wants a plain decimal with a dot, two places: "199.00". */
export const formatSum = (kopecks: number): string => (kopecks / 100).toFixed(2);

/** The callback's `OutSum` is whatever Robokassa chose to send ("199", "199.00", "199.000000"), so it is
 *  compared as a number of kopecks, never as a string. Returns null for anything unparseable. */
export function parseSum(raw: string): number | null {
  if (!/^\d+([.,]\d+)?$/.test(raw.trim())) return null;
  const value = Number(raw.trim().replace(',', '.'));
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

const hash = (algo: HashAlgo, input: string): string => createHash(algo).update(input, 'utf8').digest('hex');

/** `InvId` must be unique per shop (the docs require uniqueness, NOT monotonicity), which is what lets
 *  us mint it randomly instead of maintaining a counter — a serverless fleet has nowhere to keep one
 *  without turning every checkout into a contended write. 63 bits is Robokassa's ceiling; we stay well
 *  under it and keep the value a decimal STRING end to end, so no step ever rounds it through a float. */
export function newInvoiceId(): string {
  const n = BigInt('0x' + randomBytes(8).toString('hex')) % 900_000_000_000_000_000n;
  return (n + 100_000_000_000_000_000n).toString();
}

export type CheckoutParams = {
  merchantLogin: string;
  password1: string;
  algo: HashAlgo;
  outSum: string;
  invoiceId: string;
  description: string;
  /** Minimised receipt JSON from `buildReceipt`, UNENCODED. Required rather than optional: an optional
   *  one is a way to ship with the cheque switched off after fiscalisation is switched on, which is the
   *  one state that must not exist. */
  receipt: string;
  /**
   * Marks the invoice as the PARENT of a recurring chain. It can only ever be set on the first payment:
   * `Merchant/Recurring` needs a `PreviousInvoiceID` that was itself flagged, and no later call can
   * retrofit it.
   *
   * Off by default all the same. Robokassa requires the shop to be approved for periodic payments, and
   * whether an unapproved shop merely ignores the flag or REFUSES the invoice is not something we know —
   * guessing wrong breaks every purchase, not just recurring ones. Until the monthly charge job exists
   * the flag buys nothing anyway, so it waits behind `ROBOKASSA_RECURRING=1`.
   */
  recurring: boolean;
  isTest: boolean;
};

/**
 * The fiscal receipt: what the payer's cheque says they bought.
 *
 * Required from the moment Робочеки СМЗ is switched on. Without it a fiscalised shop issues a cheque
 * whose only line is "Свободная продажа" — the wrong-номенклатура state the activation letter warns
 * about, with the tax authority on the other end of it.
 *
 * `sno` is deliberately absent: the allowed values are `osn`, `usn_income`, `usn_income_outcome`, `esn`
 * and `patent`, and НПД is none of them, so the shop's own setting applies. `tax: 'none'` because
 * self-employment pays no VAT. `sum` is a NUMBER, not the `OutSum` string, and must add up to the
 * payment — a cheque whose lines do not match the amount is rejected while the money is already taken.
 *
 * ASCII-escaped on purpose. `JSON.stringify` emits raw UTF-8, which survives the signature perfectly and
 * can still arrive as mojibake in the cheque if anything downstream decodes with another default — a
 * failure invisible to every test we can write, and visible to the buyer.
 */
export function buildReceipt(plan: PlanSpec): string {
  const json = JSON.stringify({
    items: [
      {
        name: plan.receiptName.slice(0, 128),
        quantity: 1,
        sum: plan.priceKopecks / 100,
        tax: 'none',
        payment_method: 'full_payment',
        payment_object: 'service',
      },
    ],
  });
  return json.replace(/[^\x20-\x7E]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

/**
 * `Receipt` joins the signature in the documented position, encoded ONCE — while the query carries it
 * encoded TWICE. That is not a quirk of ours: the vendor's own worked example pairs a URL containing
 * `%257B` with a signature string containing `%7B`, because their framework decodes the query once and
 * compares the result to what was signed. Encoding both the same way is the mistake that breaks every
 * purchase, and it fails as "неверная подпись" — indistinguishable from a wrong password.
 */
export const checkoutSignature = (p: CheckoutParams): string =>
  hash(
    p.algo,
    `${p.merchantLogin}:${p.outSum}:${p.invoiceId}:${encodeURIComponent(p.receipt)}:${p.password1}`
  );

export function checkoutUrl(p: CheckoutParams): string {
  const q = new URLSearchParams({
    MerchantLogin: p.merchantLogin,
    OutSum: p.outSum,
    InvId: p.invoiceId,
    Description: p.description.slice(0, 100),
    // The once-encoded receipt, handed to `URLSearchParams` — which escapes its `%` signs and so adds
    // the second layer the wire needs. Doing it by hand is what would get this wrong: the value now
    // holds no spaces, so there is no `+`-versus-`%20` question left to answer here.
    Receipt: encodeURIComponent(p.receipt),
    SignatureValue: checkoutSignature(p),
    Culture: 'ru',
    Encoding: 'utf-8',
  });
  if (p.recurring) q.set('Recurring', 'true');
  if (p.isTest) q.set('IsTest', '1');
  return `${ROBOKASSA_CHECKOUT_URL}?${q.toString()}`;
}

/** ResultURL uses Пароль#2 — the one that never appears in anything the browser can see, which is the
 *  entire reason the callback can be trusted and `SuccessURL` (Пароль#1, reachable from the payer's
 *  address bar) cannot. Nothing is granted on the strength of a SuccessURL hit. */
export const resultSignature = (outSum: string, invoiceId: string, password2: string, algo: HashAlgo): string =>
  hash(algo, `${outSum}:${invoiceId}:${password2}`);

/** Case-insensitive (Robokassa sends upper case, Node produces lower) and length-checked before the
 *  timing-safe compare, which throws on unequal buffers. */
export function verifyResultSignature(
  outSum: string,
  invoiceId: string,
  received: string,
  password2: string,
  algo: HashAlgo
): boolean {
  const expected = resultSignature(outSum, invoiceId, password2, algo);
  const got = Buffer.from(received.trim().toLowerCase(), 'utf8');
  const want = Buffer.from(expected, 'utf8');
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Robokassa retries the callback until it reads back exactly this, as plain text. A JSON body, or an
 *  empty 200, leaves the notification in their retry queue forever. */
export const resultAck = (invoiceId: string): string => `OK${invoiceId}`;

export type BillingConfig = {
  merchantLogin: string;
  password1: string;
  password2: string;
  algo: HashAlgo;
  isTest: boolean;
  /** See `CheckoutParams.recurring` — opt-in, and only once Robokassa has approved periodic payments. */
  recurring: boolean;
};

/**
 * Absent or malformed config means billing is simply unavailable, exactly like TOTP without its sealing
 * key: the routes answer 503 and the UI hides the button, rather than the app half-working and taking
 * money it cannot account for.
 *
 * In Robokassa's test mode the passwords are DIFFERENT values (the panel issues a separate test pair),
 * so `ROBOKASSA_IS_TEST` only sets the flag on the link — whoever turns it on must swap the secrets too.
 */
export function billingConfig(): BillingConfig | null {
  const merchantLogin = process.env.ROBOKASSA_LOGIN;
  const password1 = process.env.ROBOKASSA_PASSWORD1;
  const password2 = process.env.ROBOKASSA_PASSWORD2;
  if (!merchantLogin || !password1 || !password2) return null;
  const raw = (process.env.ROBOKASSA_ALGO ?? 'md5').toLowerCase();
  if (!isHashAlgo(raw)) return null;
  return {
    merchantLogin,
    password1,
    password2,
    algo: raw,
    isTest: process.env.ROBOKASSA_IS_TEST === '1',
    recurring: process.env.ROBOKASSA_RECURRING === '1',
  };
}

export const billingConfigured = (): boolean => billingConfig() !== null;
