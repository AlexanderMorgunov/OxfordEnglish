/**
 * YDB schema migration. Tables are NOT created by the app at runtime, so this must run against a
 * database BEFORE deploying code that queries the new tables — otherwise those routes 500.
 *
 * Idempotent: each table is probed with a zero-row SELECT and skipped if it already answers, so
 * re-running is safe. ydb-sdk 5.x has no `executeSchemeQuery`, hence `session.createTable` rather than
 * the `CREATE TABLE` YQL in docs/yc-backend-setup.md (that YQL is the readable spec; this is what runs).
 *
 * Run:  MSYS_NO_PATHCONV=1 YDB_ENDPOINT=… YDB_DATABASE=… \
 *       YDB_ACCESS_TOKEN_CREDENTIALS=$(yc iam create-token) npx tsx src/migrate.ts
 */
import ydbSdk from 'ydb-sdk';
import { driver, query } from './ydb.js';
import { TRIAL_CLAIM_RETENTION_MS } from './entitlements.js';
import { AI_CACHE_TTL_DAYS } from './stores/ydbAiCache.js';

// ydb-sdk is CommonJS; Node's ESM interop hides its named exports behind the default.
const { Column, TableDescription, Types, AlterTableDescription, TableIndex } = ydbSdk;

// TtlSettings is not re-exported from the SDK index (AlterTableDescription is), so build the shape its
// constructor produces: { dateTypeColumn: { columnName, expireAfterSeconds } }.
const ttlSettings = (columnName: string, expireAfterSeconds: number) => ({ dateTypeColumn: { columnName, expireAfterSeconds } });

const utf8 = () => Types.optional(Types.UTF8);
const ts = () => Types.optional(Types.TIMESTAMP);
const u32 = () => Types.optional(Types.UINT32);
const bool = () => Types.optional(Types.BOOL);

type Table = { name: string; describe: () => InstanceType<typeof TableDescription> };

const TABLES: Table[] = [
  {
    name: 'entitlements',
    describe: () =>
      new TableDescription()
        .withColumn(new Column('account_id', utf8()))
        .withColumn(new Column('trial_started_at', ts()))
        .withColumn(new Column('paid_until', ts()))
        .withColumn(new Column('ai_used', u32()))
        .withColumn(new Column('window_started_at', ts()))
        .withPrimaryKey('account_id'),
  },
  {
    name: 'trial_claims',
    // TTL so an erasure request doesn't leave a device-derived row forever; past the retention window
    // the row could only ever block a trial that has already expired.
    describe: () =>
      new TableDescription()
        .withColumn(new Column('install_hash', utf8()))
        .withColumn(new Column('claimed_at', ts()))
        .withPrimaryKey('install_hash')
        .withTtl('claimed_at', Math.floor(TRIAL_CLAIM_RETENTION_MS / 1000)),
  },
  {
    name: 'ai_cache',
    describe: () =>
      new TableDescription()
        .withColumn(new Column('cache_key', utf8()))
        .withColumn(new Column('task', utf8()))
        .withColumn(new Column('content', utf8()))
        .withColumn(new Column('created_at', ts()))
        .withPrimaryKey('cache_key')
        .withTtl('created_at', AI_CACHE_TTL_DAYS * 24 * 60 * 60),
  },
  {
    name: 'totp',
    // No TTL: the enrollment must outlive everything, since it is the last way back into a paid account.
    describe: () =>
      new TableDescription()
        .withColumn(new Column('account_id', utf8()))
        .withColumn(new Column('secret_enc', utf8()))
        .withColumn(new Column('confirmed_at', ts()))
        .withColumn(new Column('last_step', u32()))
        .withColumn(new Column('backup_hashes', utf8()))
        .withColumn(new Column('fail_count', u32()))
        .withColumn(new Column('fail_window_start', ts()))
        .withPrimaryKey('account_id'),
  },
  {
    name: 'recovery_names',
    // Composite key because names are deliberately NOT unique — several accounts may answer to one, and
    // the authenticator code picks between them. `account_id` sits here in the clear, which it must for
    // the lookup to resolve to anything; the HMAC only keeps the NAME unreadable. No TTL: like the totp
    // row this is a way back into a paid account and has to outlive everything.
    describe: () =>
      new TableDescription()
        .withColumn(new Column('name_hash', utf8()))
        .withColumn(new Column('account_id', utf8()))
        .withColumn(new Column('created_at', ts()))
        .withPrimaryKeys('name_hash', 'account_id'),
  },
  {
    name: 'recovery_name_attempts',
    // Failures are charged to the NAME, never to the accounts behind it: ten attempts with a common name
    // would otherwise lock every holder of it out of their own recovery. TTL because a row is meaningless
    // once its window has passed, and a day is far clear of the fifteen-minute window.
    describe: () =>
      new TableDescription()
        .withColumn(new Column('name_hash', utf8()))
        .withColumn(new Column('fail_count', u32()))
        .withColumn(new Column('fail_window_start', ts()))
        .withPrimaryKey('name_hash')
        .withTtl('fail_window_start', 24 * 60 * 60),
  },
  {
    name: 'payment_grants',
    // No TTL, unlike every other table here: these ARE the payment records. `invoice_id` is also the
    // parent a future recurring charge is filed against, so a grant has to outlive the subscription.
    describe: () =>
      new TableDescription()
        .withColumn(new Column('grant_token', utf8()))
        .withColumn(new Column('payment_ref', utf8()))
        .withColumn(new Column('invoice_id', utf8()))
        .withColumn(new Column('amount_kopecks', u32()))
        .withColumn(new Column('days', u32()))
        .withColumn(new Column('bound_to', utf8()))
        .withColumn(new Column('paid', bool()))
        .withColumn(new Column('redeemed', bool()))
        .withColumn(new Column('created_at', ts()))
        .withColumn(new Column('paid_at', ts()))
        .withPrimaryKey('grant_token'),
  },
];

async function exists(name: string): Promise<boolean> {
  try {
    await query(`SELECT * FROM ${name} LIMIT 0;`);
    return true;
  } catch {
    return false;
  }
}

if (!process.env.YDB_DATABASE) {
  console.error('YDB_DATABASE is not set — refusing to run against nothing.');
  process.exit(1);
}

console.log(`migrating ${process.env.YDB_DATABASE}`);
let created = 0;
for (const t of TABLES) {
  if (await exists(t.name)) {
    console.log(`· ${t.name} — already present, skipped`);
    continue;
  }
  const d = await driver();
  await d.tableClient.withSession((session) => session.createTable(t.name, t.describe()));
  console.log(`+ ${t.name} — created`);
  created += 1;
}

/**
 * TTLs added to tables that already existed before they had one. Setting a TTL is idempotent — the same
 * settings applied twice is a no-op — so this runs unconditionally.
 *
 * `idempotency` is the load-bearing entry: each row holds the ENTIRE PushResult, payloads included, and
 * nothing ever deleted them. It was measured as ~56% of all database growth, against a 50 GiB ceiling.
 * The row exists only to make a retried push idempotent, which stops mattering within minutes; a day is
 * already generous.
 */
const TTLS: Array<{ table: string; column: string; seconds: number; why: string }> = [
  { table: 'idempotency', column: 'created_at', seconds: 24 * 60 * 60, why: 'replay window is minutes, not forever' },
  // Nothing deleted expired refresh rows, and rotation UPSERTs a NEW row per refresh while keeping the
  // old one (its `used=true` is the reuse-detection signal, so it must not simply be deleted). Expiring
  // them on their own `expires_at` bounds a table that otherwise grows a row per refresh, forever.
  { table: 'refresh_tokens', column: 'expires_at', seconds: 0, why: 'an expired token is already useless' },
  // A link request that nobody polls again is never cleaned up — and an APPROVED one holds a RAW refresh
  // token until collected, which is the one place a live token sits unhashed at rest.
  { table: 'link_requests', column: 'expires_at', seconds: 60 * 60, why: 'abandoned requests hold a raw token' },
];

/**
 * Indexes added to tables that predate them. `alterTable` with `addIndexes` builds a global secondary
 * index online; re-running would fail on an index that already exists, so each is probed first.
 */
const INDEXES: Array<{ table: string; name: string; columns: string[]; why: string }> = [
  {
    table: 'refresh_tokens',
    name: 'by_account',
    columns: ['account_id', 'device_id'],
    why: 'revoke-device and delete-account were full scans of EVERY user\'s tokens',
  },
  {
    table: 'payment_grants',
    name: 'by_invoice',
    columns: ['invoice_id'],
    why: 'the payment callback knows only the invoice number, never the grant token',
  },
  {
    table: 'payment_grants',
    name: 'by_bound',
    columns: ['bound_to'],
    why: 'a buyer whose device lost the grant token would otherwise need a support ticket',
  },
  {
    table: 'recovery_names',
    name: 'by_account',
    columns: ['account_id'],
    why: 'setting a name must delete the old row, and the account purge must find them by account',
  },
];

/**
 * Columns added to tables that predate them. Optional columns only — YDB has no DEFAULT, so every
 * pre-existing row reads NULL and the code must already treat that as the absent case.
 */
const COLUMNS: Array<{ table: string; name: string; type: ReturnType<typeof utf8>; why: string }> = [
  { table: 'payment_grants', name: 'invoice_id', type: utf8(), why: 'the acquirer identifies a payment by invoice, not by our token' },
  { table: 'payment_grants', name: 'amount_kopecks', type: u32(), why: 'a valid signature proves who sent the callback, not what was priced' },
  { table: 'payment_grants', name: 'paid', type: bool(), why: 'a grant is minted at checkout and confirmed later; NULL reads as unpaid' },
  { table: 'payment_grants', name: 'paid_at', type: ts(), why: 'audit trail for a confirmed payment' },
  // The failure counter used to be shared between /v1/totp/recover, which needs no session, and the
  // owner's own routes — so a stranger who knew an account id could lock the owner out of reissuing
  // backup codes or disabling TOTP, ten requests at a time, indefinitely.
  { table: 'totp', name: 'anon_fail_count', type: u32(), why: 'unauthenticated attempts must not spend the owner’s budget' },
  { table: 'totp', name: 'anon_fail_window_start', type: ts(), why: 'window for the unauthenticated counter' },
];

async function hasColumn(table: string, column: string): Promise<boolean> {
  try {
    await query(`SELECT ${column} FROM ${table} LIMIT 0;`);
    return true;
  } catch {
    return false;
  }
}

async function hasIndex(table: string, name: string): Promise<boolean> {
  try {
    await query(`SELECT * FROM ${table} VIEW ${name} LIMIT 0;`);
    return true;
  } catch {
    return false;
  }
}

let altered = 0;
for (const t of TTLS) {
  if (!(await exists(t.table))) {
    console.log(`· ${t.table} — absent, TTL skipped`);
    continue;
  }
  const d = await driver();
  const desc = new AlterTableDescription();
  desc.setTtlSettings = ttlSettings(t.column, t.seconds);
  await d.tableClient.withSession((session) => session.alterTable(t.table, desc));
  console.log(`~ ${t.table} — TTL ${t.seconds}s on ${t.column} (${t.why})`);
  altered += 1;
}

// Before the indexes: an index cannot be built on a column that does not exist yet.
let added = 0;
for (const col of COLUMNS) {
  if (!(await exists(col.table))) {
    console.log(`· ${col.table} — absent, column skipped`);
    continue;
  }
  if (await hasColumn(col.table, col.name)) {
    console.log(`· ${col.table}.${col.name} — already present, skipped`);
    continue;
  }
  const d = await driver();
  const desc = new AlterTableDescription();
  desc.addColumns.push(new Column(col.name, col.type));
  await d.tableClient.withSession((session) => session.alterTable(col.table, desc));
  console.log(`+ ${col.table}.${col.name} — added (${col.why})`);
  added += 1;
}

let indexed = 0;
for (const ix of INDEXES) {
  if (!(await exists(ix.table))) {
    console.log(`· ${ix.table} — absent, index skipped`);
    continue;
  }
  if (await hasIndex(ix.table, ix.name)) {
    console.log(`· ${ix.table}.${ix.name} — already present, skipped`);
    continue;
  }
  const d = await driver();
  const desc = new AlterTableDescription();
  desc.addIndexes.push(new TableIndex(ix.name).withIndexColumns(...ix.columns).withGlobalAsync(false));
  await d.tableClient.withSession((session) => session.alterTable(ix.table, desc));
  console.log(`+ ${ix.table}.${ix.name} on (${ix.columns.join(', ')}) — created (${ix.why})`);
  indexed += 1;
}

console.log(
  created === 0 && altered === 0 && indexed === 0 && added === 0
    ? '\nnothing to do — schema already current'
    : `\n${created} table(s) created, ${altered} TTL(s) applied, ${added} column(s) added, ${indexed} index(es) created`
);
(await driver()).destroy();
