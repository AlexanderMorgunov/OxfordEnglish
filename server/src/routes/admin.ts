/**
 * Owner-only admin: how many people are here, and hand someone Pro.
 *
 * Reachable only when `ADMIN_TOKEN` is set, and `createApp` does not mount this router at all without
 * one — a surface that was never mounted cannot be misconfigured. Deliberately NOT an IP check: the
 * server runs behind a serverless platform where the peer address is the platform's, so "is this
 * localhost" is not a question this process can answer honestly.
 *
 * The numbers it reports are whatever database the process is pointed at. Run against a dev server with
 * no `YDB_DATABASE` it answers zero, truthfully and uselessly — so the page states which backend it read.
 */
import { Hono } from 'hono';
import type { AuthStore } from '../store.js';
import { applyPayment, evaluate, type EntitlementStore } from '../entitlements.js';
import { computeStats } from '../adminStats.js';
import { constantTimeEqual } from '../secrets.js';
import { ErrorCode, IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC } from '../contract.js';
import { ipBucketLimiter } from '../rateLimit.js';
import { CatalogSettingsSchema, catalogAt, type BillingCatalogStore } from '../billingCatalog.js';

/** Long enough that a shell-history token is not the only thing between the internet and a free plan. */
export const ADMIN_TOKEN_MIN = 24;

/** A granted period is added to whatever is already there, so the ceiling only bounds one mistake. There
 *  is no undo — `applyPayment` can only extend — which is the real reason to keep it small. */
const MAX_GRANT_DAYS = 400;

export function adminRoutes(app: Hono, token: string, auth: AuthStore, ent: EntitlementStore, catalog: BillingCatalogStore): Hono {
  const err = (code: ErrorCode, status: 400 | 401 | 404) => Response.json({ error: code }, { status });

  // In FRONT of the token check, so a rejected guess still costs a token — behind it the limiter would
  // throttle only the owner. Its own bucket map, like every other route's: abuse of one endpoint must
  // not starve another, and granting a plan is the one call here that must stay available.
  app.use('/v1/admin/*', ipBucketLimiter(IP_BUCKET_CAPACITY, IP_BUCKET_REFILL_PER_SEC));

  app.use('/v1/admin/*', async (c, next) => {
    const header = c.req.header('authorization') ?? '';
    const presented = header.startsWith('Bearer ') ? header.slice(7) : '';
    // Length is checked inside `constantTimeEqual`, which is what keeps `timingSafeEqual` from throwing
    // on a short token and answering through the exception instead of the comparison.
    if (!constantTimeEqual(presented, token)) return err(ErrorCode.Unauthorized, 401);
    await next();
  });

  app.get('/v1/admin/stats', async (c) => {
    const [accounts, rows] = await Promise.all([auth.countAccounts(), ent.statsRows()]);
    return c.json(computeStats(accounts, rows, Date.now()));
  });

  app.get('/v1/admin/billing', async (c) => {
    c.header('Cache-Control', 'no-store');
    const settings = await catalog.get();
    return c.json({ settings, catalog: catalogAt(settings, Date.now(), true) });
  });
  app.post('/v1/admin/billing', async (c) => {
    const body = CatalogSettingsSchema.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return err(ErrorCode.BadRequest, 400);
    const settings = await catalog.replace(body.data.revision, body.data.campaign);
    if (!settings) return c.json({ error: 'catalog_conflict' }, 409);
    c.header('Cache-Control', 'no-store');
    return c.json({ settings, catalog: catalogAt(settings, Date.now(), true) });
  });

  app.get('/v1/admin/accounts/:id', async (c) => {
    const id = c.req.param('id');
    if (!(await auth.getAccount(id))) return err(ErrorCode.NoSuchAccount, 404);
    const row = await ent.get(id);
    return c.json({ accountId: id, entitlement: evaluate(row, Date.now()) });
  });

  app.post('/v1/admin/grant', async (c) => {
    const body = (await c.req.json().catch(() => null)) as { accountId?: unknown; days?: unknown } | null;
    const id = typeof body?.accountId === 'string' ? body.accountId.trim() : '';
    const days = typeof body?.days === 'number' ? Math.trunc(body.days) : NaN;
    if (!id || !Number.isFinite(days) || days < 1 || days > MAX_GRANT_DAYS) return err(ErrorCode.BadRequest, 400);

    // Existence lives in the AUTH store: an entitlement row is only created by a trial or a payment, so
    // `ent.get` answers null for a typo and for an ordinary free user alike. Without this a mistyped id
    // writes an orphan row for an account that cannot exist, and the real buyer is told it worked.
    if (!(await auth.getAccount(id))) return err(ErrorCode.NoSuchAccount, 404);

    const now = Date.now();
    // `mutate`, not get → put: the store's own contract says a plain read-modify-write is not good
    // enough for spending money. A grant issued while the user is burning AI quota would otherwise
    // write back a whole row and erase one of the two.
    const row = await ent.mutate(id, (current) => {
      const next = applyPayment(current, id, now, days);
      return { row: next, result: next };
    });
    console.log(`[admin] granted ${days}d to ${id}, paid until ${new Date(row.paidUntil ?? 0).toISOString()}`);
    return c.json({ accountId: id, entitlement: evaluate(row, now) });
  });

  return app;
}

/**
 * The page, served by this server rather than built into the app.
 *
 * The first design put an `/admin` route in the client bundle behind a build flag. It does not work:
 * `lazy(() => import(...))` is not treated as side-effect-free, so the chunk ships anyway — and the
 * service worker precaches `**\/*.js`, which would push the admin UI onto every user's device and leave
 * it fetchable by anyone reading the precache manifest. Serving it from the process that already holds
 * the token means it exists exactly where the token does, and same-origin sidesteps CORS.
 */
export function adminPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>DayEnglish admin</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; padding: 24px; background: #12141c; color: #ece8dd;
         font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; }
  h1 { font-size: 15px; letter-spacing: .14em; text-transform: uppercase; color: #57c9bd; margin: 0 0 20px; }
  fieldset { border: 1px solid #2a2e3e; border-radius: 4px; margin: 0 0 20px; padding: 14px 16px; }
  legend { color: #57c9bd; padding: 0 6px; }
  input, button { font: inherit; background: #1a1d29; color: inherit;
                  border: 1px solid #2a2e3e; border-radius: 4px; padding: 7px 10px; max-width:100%; box-sizing:border-box; }
  button { cursor: pointer; }
  button:hover { border-color: #57c9bd; }
  table { border-collapse: collapse; }
  td { padding: 3px 18px 3px 0; }
  td:last-child { color: #57c9bd; text-align: right; }
  .muted { color: #8b90a0; }
  .bad { color: #e8706a; }
  .ok { color: #57c9bd; }
  pre { white-space: pre-wrap; word-break: break-all; margin: 10px 0 0; }
</style></head><body>
<h1>DayEnglish · admin</h1>

<fieldset><legend>token</legend>
  <input id="tok" type="password" size="34" placeholder="ADMIN_TOKEN" autocomplete="off">
  <button id="save">use</button>
  <span id="who" class="muted"></span>
</fieldset>

<fieldset><legend>counts</legend>
  <div id="stats" class="muted">—</div>
  <p class="muted">Whatever database this server is pointed at. Accounts that exist now, not ever registered.</p>
</fieldset>

<fieldset><legend>grant pro</legend>
  <input id="gid" size="26" placeholder="account id" autocomplete="off">
  <input id="gdays" type="number" value="30" min="1" max="${MAX_GRANT_DAYS}" style="width:6em">
  <button id="grant">grant</button>
  <p class="muted">Adds to whatever the account already has. There is no undo.</p>
  <pre id="out"></pre>
</fieldset>

<fieldset><legend>Распродажа Pro · время Москвы (UTC+3)</legend>
  <p>Постоянные планы: 30 дней — 199 ₽; 90 дней — 499 ₽; 365 дней — 1499 ₽.</p>
  <p id="sale-status" role="status">Введите токен и загрузите настройки.</p>
  <form id="sale-form">
    <p><label>ID новой кампании <input id="sale-id" required pattern="[a-z0-9-]{1,60}" maxlength="60"></label></p>
    <p><label>Название <input id="sale-title" required maxlength="80"></label></p>
    <p><label>Начало <input id="sale-start" type="datetime-local" required></label></p>
    <p><label>Окончание (не включительно) <input id="sale-end" type="datetime-local" required></label></p>
    <p>Например, для акции по 10 ноября включительно укажите 11 ноября, 00:00.</p>
    <p><label>1 месяц, ₽ <input id="sale-month" type="number" min="0.01" max="198.99" step="0.01" required></label></p>
    <p><label>3 месяца, ₽ <input id="sale-quarter" type="number" min="0.01" max="498.99" step="0.01" required></label></p>
    <p><label>Год, ₽ <input id="sale-year" type="number" min="0.01" max="1498.99" step="0.01" required></label></p>
    <button id="sale-save" disabled>Сохранить расписание</button>
    <button id="sale-disable" type="button" disabled>Отключить акцию</button>
    <button id="sale-load" type="button">Обновить настройки</button>
  </form>
  <p>Расписание работает автоматически по часам сервера. Для следующей акции используйте новый ID.
    Изменения касаются новых заказов; ранее созданные сохраняют свою сумму.</p>
</fieldset>

<script>
  // sessionStorage, not localStorage: an owner token outliving a closed tab on a shared machine is the
  // thing this is meant to make harder.
  const KEY = 'dayenglish-admin-token';
  const $ = (id) => document.getElementById(id);
  const tok = () => sessionStorage.getItem(KEY) || '';
  const api = (path, init) => fetch(path, {
    ...init,
    headers: { ...(init && init.headers), authorization: 'Bearer ' + tok(), 'content-type': 'application/json' },
  });

  async function stats() {
    if (!tok()) { $('stats').textContent = 'token first'; return; }
    const r = await api('/v1/admin/stats');
    if (!r.ok) { $('stats').innerHTML = '<span class="bad">' + r.status + '</span>'; return; }
    const s = await r.json();
    $('stats').innerHTML = '<table>' + Object.entries(s)
      .map(([k, v]) => '<tr><td>' + k + '</td><td>' + v + '</td></tr>').join('') + '</table>';
  }

  $('save').onclick = () => { sessionStorage.setItem(KEY, $('tok').value.trim()); $('tok').value = ''; stats(); loadSale(); };
  $('grant').onclick = async () => {
    const body = JSON.stringify({ accountId: $('gid').value.trim(), days: Number($('gdays').value) });
    const r = await api('/v1/admin/grant', { method: 'POST', body });
    const text = await r.text();
    $('out').innerHTML = '<span class="' + (r.ok ? 'ok' : 'bad') + '">' + r.status + '</span> ' +
      text.replace(/[<&]/g, (ch) => (ch === '<' ? '&lt;' : '&amp;'));
    if (r.ok) stats();
  };
  $('who').textContent = location.origin;
  let saleRevision = null;
  let saleBusy = false;
  const moscowInput = ms => new Date(ms + 3 * 3600000).toISOString().slice(0,16);
  function showSale(data) {
    saleRevision = data.settings.revision;
    const c = data.settings.campaign;
    $('sale-status').textContent = c ? (data.catalog.campaign ? 'Акция активна.' : data.catalog.serverTime < c.startsAt ? 'Акция запланирована.' : 'Акция завершена. Действуют стандартные цены.') : 'Акция отключена. Действуют стандартные цены.';
    if (c) {
      $('sale-id').value = c.id; $('sale-title').value = c.title;
      $('sale-start').value = moscowInput(c.startsAt); $('sale-end').value = moscowInput(c.endsAt);
      for (const [key, code] of [['month','pro_month'],['quarter','pro_quarter'],['year','pro_year']]) $('sale-' + key).value = c.prices[code] / 100;
    }
    $('sale-save').disabled = false; $('sale-disable').disabled = !c;
  }
  async function loadSale() {
    if (saleBusy || !tok()) return;
    saleBusy = true;
    try {
      const r = await api('/v1/admin/billing', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      showSale(await r.json());
    } catch { saleRevision = null; $('sale-save').disabled = true; $('sale-disable').disabled = true; $('sale-status').textContent = 'Не удалось загрузить настройки. Проверьте токен и соединение.'; }
    finally { saleBusy = false; }
  }
  async function saveSale(campaign) {
    if (saleBusy || saleRevision == null) return;
    saleBusy = true; $('sale-save').disabled = true; $('sale-disable').disabled = true;
    try {
      const r = await api('/v1/admin/billing', { method: 'POST', body: JSON.stringify({ revision: saleRevision, campaign }) });
      if (r.status === 409) { saleRevision = null; $('sale-status').textContent = 'Настройки изменены в другой вкладке. Обновите их перед сохранением.'; return; }
      if (!r.ok) throw new Error('HTTP ' + r.status);
      showSale(await r.json());
    } catch { saleRevision = null; $('sale-status').textContent = 'Результат сохранения неизвестен. Обновите настройки перед повтором.'; }
    finally { saleBusy = false; }
  }
  $('sale-load').onclick = loadSale;
  $('sale-disable').onclick = () => { if (confirm('Отключить акцию для новых заказов?')) saveSale(null); };
  $('sale-form').onsubmit = event => {
    event.preventDefault();
    const campaign = { id: $('sale-id').value, title: $('sale-title').value.trim(),
      startsAt: Date.parse($('sale-start').value + ':00+03:00'), endsAt: Date.parse($('sale-end').value + ':00+03:00'),
      prices: { pro_month: Math.round(Number($('sale-month').value)*100), pro_quarter: Math.round(Number($('sale-quarter').value)*100), pro_year: Math.round(Number($('sale-year').value)*100) } };
    if (!(campaign.endsAt > campaign.startsAt)) { $('sale-status').textContent = 'Окончание должно быть позже начала.'; return; }
    if (confirm('Применить расписание и цены к новым заказам?')) saveSale(campaign);
  };
  stats();
  loadSale();
</script>
</body></html>`;
}
