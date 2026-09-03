/**
 * YDB connection + query helpers (Track B). The container authenticates via its SA metadata identity
 * (set YDB_METADATA_CREDENTIALS=1); a local smoke authenticates with an IAM token
 * (YDB_ACCESS_TOKEN_CREDENTIALS=<token>). `getCredentialsFromEnv` picks the right one from env.
 *
 * `query` runs a one-shot statement; `withSerializableTx` runs an interactive serializable transaction
 * (read → resolve-in-JS → write, committed atomically) — the primitive the sync push needs for F1.
 */
import ydbSdk from 'ydb-sdk';
import type { Driver as YdbDriver, IAuthService } from 'ydb-sdk';
import { Metadata } from '@grpc/grpc-js';

// ydb-sdk is CommonJS; Node's ESM interop doesn't expose its named exports, so pull them off the default.
const { Driver, TokenAuthService, TypedData, TypedValues, Types } = ydbSdk;

export { TypedValues, Types };

const METADATA_TOKEN_URL = 'http://169.254.169.254/computeMetadata/v1/instance/service-accounts/default/token';

/** Container auth: fetch + refresh the SA's IAM token from the instance metadata service, without pulling
 *  in the heavy `@yandex-cloud/nodejs-sdk` that ydb-sdk's own MetadataAuthService requires. */
class MetadataAuth implements IAuthService {
  private token = '';
  private expiresAt = 0;
  async getAuthMetadata(): Promise<Metadata> {
    if (!this.token || Date.now() > this.expiresAt - 60_000) {
      const res = await fetch(METADATA_TOKEN_URL, { headers: { 'Metadata-Flavor': 'Google' } });
      if (!res.ok) throw new Error(`metadata token fetch failed: ${res.status}`);
      const j = (await res.json()) as { access_token: string; expires_in: number };
      this.token = j.access_token;
      this.expiresAt = Date.now() + j.expires_in * 1000;
    }
    const md = new Metadata();
    md.add('x-ydb-auth-ticket', this.token);
    return md;
  }
}

/** Local/dev: an IAM token via YDB_ACCESS_TOKEN_CREDENTIALS. Container: the SA metadata identity. */
function authService(): IAuthService {
  const token = process.env.YDB_ACCESS_TOKEN_CREDENTIALS;
  return token ? new TokenAuthService(token) : new MetadataAuth();
}

/** True when a real YDB is configured; else the app falls back to the in-memory stores (local/tests). */
export function ydbConfigured(): boolean {
  return !!process.env.YDB_DATABASE;
}

let driverPromise: Promise<YdbDriver> | null = null;

function initDriver(): Promise<YdbDriver> {
  const endpoint = process.env.YDB_ENDPOINT ?? '';
  const database = process.env.YDB_DATABASE ?? '';
  const driver = new Driver({ endpoint, database, authService: authService() });
  return driver.ready(15000).then((ok) => {
    if (!ok) throw new Error('YDB driver failed to become ready');
    return driver;
  });
}

export function driver(): Promise<YdbDriver> {
  return (driverPromise ??= initDriver());
}

type Rows = Record<string, unknown>[];

/** Run a single YQL statement, returning each result set as plain JS objects. */
export async function query(yql: string, params: Record<string, unknown> = {}): Promise<Rows[]> {
  const d = await driver();
  return d.tableClient.withSession(async (session) => {
    const res = await session.executeQuery(yql, params as never);
    return res.resultSets.map((rs) => TypedData.createNativeObjects(rs) as Rows);
  });
}

export interface Tx {
  /** Execute a statement within the transaction; set `commit` on the final call to commit atomically. */
  exec(yql: string, params?: Record<string, unknown>, commit?: boolean): Promise<Rows[]>;
}

/** Run an interactive serializable transaction. The first exec begins it; a later exec with `commit=true`
 *  commits. Any throw rolls back (the session is returned to the pool without a commit). */
export async function withSerializableTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const d = await driver();
  return d.tableClient.withSession(async (session) => {
    let txId: string | undefined;
    const exec = async (yql: string, params: Record<string, unknown> = {}, commit = false): Promise<Rows[]> => {
      const txControl = txId
        ? { txId, commitTx: commit }
        : { beginTx: { serializableReadWrite: {} }, commitTx: commit };
      const res = await session.executeQuery(yql, params as never, txControl);
      txId = res.txMeta?.id ?? txId;
      return res.resultSets.map((rs) => TypedData.createNativeObjects(rs) as Rows);
    };
    return fn({ exec });
  });
}

/** Coerce a YDB numeric (may come back as a Long) to a JS number — safe for our small counters/sizes. */
export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  return Number((v as { toString(): string }).toString());
}
