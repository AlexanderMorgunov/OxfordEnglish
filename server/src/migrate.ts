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
const { Column, TableDescription, Types } = ydbSdk;

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
    name: 'payment_grants',
    describe: () =>
      new TableDescription()
        .withColumn(new Column('grant_token', utf8()))
        .withColumn(new Column('payment_ref', utf8()))
        .withColumn(new Column('days', u32()))
        .withColumn(new Column('bound_to', utf8()))
        .withColumn(new Column('redeemed', bool()))
        .withColumn(new Column('created_at', ts()))
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

console.log(created === 0 ? '\nnothing to do — schema already current' : `\n${created} table(s) created`);
(await driver()).destroy();
