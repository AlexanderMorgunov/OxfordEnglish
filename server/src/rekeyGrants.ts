/**
 * One-off: move `payment_grants.bound_to` from a plain SHA-256 to the keyed, versioned form.
 *
 * Why it exists: the old binding was `sha256('grant:' + accountId)`, which hides who paid only while
 * account ids are unguessable. They are not — an id is the prefix of every book's object key, so it
 * rides in presigned URLs, and it sits in plaintext inside the composite credential every recovered
 * user holds. Anyone with a table dump could therefore join a Robokassa invoice to an account.
 *
 * Idempotent, and safe to re-run: a row already in the new form matches no legacy hash, so a second
 * pass rewrites nothing. Re-running AFTER the deploy is part of the procedure, not a fallback — a
 * payment callback landing in the window flips `paid` without touching `bound_to`.
 *
 * Run:  MSYS_NO_PATHCONV=1 YDB_ENDPOINT=… YDB_DATABASE=… \
 *       YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) \
 *       INDEX_HMAC_KEY=$(yc lockbox payload get --name dayenglish-api-secrets --key INDEX_HMAC_KEY) \
 *       npx tsx src/rekeyGrants.ts
 *
 * Read the key FROM LOCKBOX, never by hand. A wrong key does not fail — it rewrites every grant into a
 * binding that matches nobody, which is indistinguishable from "this grant is not yours" and durable.
 */
import { query, TypedValues as T } from './ydb.js';
import { bindHash, legacyBindHash, INDEX_HASH_VERSION, indexKeyConfigured } from './entitlements.js';

const PAGE = 500;

if (!process.env.YDB_DATABASE) {
  console.error('YDB_DATABASE is not set — refusing to run against nothing.');
  process.exit(1);
}
if (!indexKeyConfigured()) {
  console.error('INDEX_HMAC_KEY is not set (or is under 32 bytes) — refusing to rewrite bindings.');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

/** Every live account id, paged. The grants table holds no id by design, so the only way to compute a
 *  row's new binding is to come at it from the account side. */
async function accountIds(): Promise<string[]> {
  const ids: string[] = [];
  let after = '';
  for (;;) {
    const [rows] = await query(
      'DECLARE $after AS Utf8; DECLARE $lim AS Uint64;' +
        ' SELECT account_id FROM accounts WHERE account_id > $after ORDER BY account_id LIMIT $lim;',
      { $after: T.utf8(after), $lim: T.uint64(PAGE) }
    );
    if (rows.length === 0) return ids;
    for (const r of rows) ids.push(String(r.account_id));
    after = ids[ids.length - 1]!;
    if (rows.length < PAGE) return ids;
  }
}

/** Grant tokens and their current binding, paged by PRIMARY KEY. Deliberately not through the `by_bound`
 *  index: that index is keyed on the very column being rewritten, so paging through it would revisit or
 *  skip rows as they move. The primary key never changes, so a scan ordered by it is stable. */
async function* grants(): AsyncGenerator<{ token: string; bound: string | null }> {
  let after = '';
  for (;;) {
    const [rows] = await query(
      'DECLARE $after AS Utf8; DECLARE $lim AS Uint64;' +
        ' SELECT grant_token, bound_to FROM payment_grants WHERE grant_token > $after ORDER BY grant_token LIMIT $lim;',
      { $after: T.utf8(after), $lim: T.uint64(PAGE) }
    );
    if (rows.length === 0) return;
    for (const r of rows) {
      yield { token: String(r.grant_token), bound: r.bound_to == null ? null : String(r.bound_to) };
      after = String(r.grant_token);
    }
    if (rows.length < PAGE) return;
  }
}

const ids = await accountIds();
const byLegacy = new Map<string, string>();
for (const id of ids) byLegacy.set(legacyBindHash(id), id);
console.log(`accounts: ${ids.length}`);

let seen = 0;
let already = 0;
let rewritten = 0;
let orphan = 0;

for await (const g of grants()) {
  seen += 1;
  if (g.bound?.startsWith(INDEX_HASH_VERSION)) {
    already += 1;
    continue;
  }
  const accountId = g.bound == null ? undefined : byLegacy.get(g.bound);
  if (!accountId) {
    // A grant whose account has been deleted: `purge` removes the accounts row, so the preimage is gone
    // and this binding can never be recomputed. Left as it is, and counted so it is not mistaken for zero.
    orphan += 1;
    continue;
  }
  if (!dryRun) {
    await query('DECLARE $g AS Utf8; DECLARE $b AS Utf8; UPDATE payment_grants SET bound_to=$b WHERE grant_token=$g;', {
      $g: T.utf8(g.token),
      $b: T.utf8(bindHash(accountId)),
    });
  }
  rewritten += 1;
}

console.log(`grants: ${seen} seen · ${already} already new-form · ${rewritten} ${dryRun ? 'would be ' : ''}rewritten · ${orphan} orphaned`);
if (orphan > 0) console.log('orphaned rows belong to deleted accounts and cannot be re-keyed — expected, not an error');
console.log(dryRun ? 'dry run: nothing written' : 'done');
