/**
 * Read-only. Answers one question: WHY does the re-keying migration find nothing to rewrite?
 *
 * Two explanations produce the same "0 would be rewritten", and they are opposites. Either those grants
 * genuinely belong to accounts that no longer exist — in which case the migration is correctly a no-op —
 * or the legacy hash it looks for does not match what is actually stored, in which case it would silently
 * skip live purchases too. This prints the shape of each row, never a value, so the difference is visible
 * without exposing a binding.
 *
 * Run with the same environment as rekeyGrants.ts (INDEX_HMAC_KEY is not needed — nothing is hashed here
 * except the legacy form, which has no key).
 */
import { query } from './ydb.js';
import { legacyBindHash, INDEX_HASH_VERSION } from './entitlements.js';

if (!process.env.YDB_DATABASE) {
  console.error('YDB_DATABASE is not set — refusing to run against nothing.');
  process.exit(1);
}

const [accRows] = await query('SELECT account_id FROM accounts LIMIT 1000;');
const live = new Map<string, string>();
for (const r of accRows) live.set(legacyBindHash(String(r.account_id)), String(r.account_id));
console.log(`live accounts: ${live.size}`);

const [rows] = await query(
  'SELECT grant_token, bound_to, paid, redeemed, days, amount_kopecks, created_at FROM payment_grants LIMIT 1000;'
);
console.log(`grants: ${rows.length}\n`);

for (const r of rows) {
  const bound = r.bound_to == null ? null : String(r.bound_to);
  const shape =
    bound === null
      ? 'bound_to is NULL — predates binding, unusable by anyone'
      : bound.startsWith(INDEX_HASH_VERSION)
        ? 'already keyed (v2)'
        : live.has(bound)
          ? 'legacy, matches a LIVE account → the migration should rewrite it'
          : `legacy, matches no live account (len ${bound.length}) → deleted account, or the legacy form differs`;
  console.log(
    [
      `token …${String(r.grant_token).slice(-6)}`,
      `paid=${r.paid ?? 'NULL'}`,
      `redeemed=${r.redeemed ?? 'NULL'}`,
      `days=${r.days ?? 'NULL'}`,
      `kopecks=${r.amount_kopecks ?? 'NULL'}`,
      `created=${r.created_at ?? 'NULL'}`,
      shape,
    ].join(' · ')
  );
}

// If every row says "matches no live account" AND they are not NULL, that is the case worth pausing on:
// it would also be what a wrong legacy hash looks like. A single matching row proves the hash is right.
const legacyNonNull = rows.filter((r) => r.bound_to != null && !String(r.bound_to).startsWith(INDEX_HASH_VERSION));
const matched = legacyNonNull.filter((r) => live.has(String(r.bound_to))).length;
console.log(
  `\nlegacy non-null rows: ${legacyNonNull.length} · of those matching a live account: ${matched}`
);
if (legacyNonNull.length > 0 && matched === 0) {
  console.log('NOTE: no legacy row matches any live account. Expected if those buyers deleted their accounts;');
  console.log('      the same output would appear if the legacy hash were computed differently. Worth confirming.');
}
