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
import { ErrorCode } from '../contract.js';

/** Long enough that a shell-history token is not the only thing between the internet and a free plan. */
export const ADMIN_TOKEN_MIN = 24;

/** A granted period is added to whatever is already there, so the ceiling only bounds one mistake. There
 *  is no undo — `applyPayment` can only extend — which is the real reason to keep it small. */
const MAX_GRANT_DAYS = 400;

export function adminRoutes(app: Hono, token: string, auth: AuthStore, ent: EntitlementStore): Hono {
  const err = (code: ErrorCode, status: 400 | 401 | 404) => Response.json({ error: code }, { status });

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
                  border: 1px solid #2a2e3e; border-radius: 4px; padding: 7px 10px; }
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

  $('save').onclick = () => { sessionStorage.setItem(KEY, $('tok').value.trim()); $('tok').value = ''; stats(); };
  $('grant').onclick = async () => {
    const body = JSON.stringify({ accountId: $('gid').value.trim(), days: Number($('gdays').value) });
    const r = await api('/v1/admin/grant', { method: 'POST', body });
    const text = await r.text();
    $('out').innerHTML = '<span class="' + (r.ok ? 'ok' : 'bad') + '">' + r.status + '</span> ' +
      text.replace(/[<&]/g, (ch) => (ch === '<' ? '&lt;' : '&amp;'));
    if (r.ok) stats();
  };
  $('who').textContent = location.origin;
  stats();
</script>
</body></html>`;
}
