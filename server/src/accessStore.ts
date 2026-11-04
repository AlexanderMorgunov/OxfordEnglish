import { AsyncLocalStorage } from 'node:async_hooks';

export interface AccessRowOptions {
  accountId?: string;
  expiresAt?: number;
}
export interface CheckpointStore {
  checkpoint(): () => void;
}
export interface AccessStore {
  available(): Promise<boolean>;
  get<T>(key: string): Promise<T | undefined>;
  put<T>(key: string, value: T, options?: AccessRowOptions): Promise<void>;
  remove(key: string): Promise<void>;
  purge(accountId: string): Promise<void>;
  atomic<T>(fn: () => Promise<T>): Promise<T>;
}

type Row = { value: unknown } & AccessRowOptions;

export class InMemoryAccessStore implements AccessStore {
  private rows = new Map<string, Row>();
  private queue: Promise<void> = Promise.resolve();
  private context = new AsyncLocalStorage<boolean>();
  constructor(private readonly participants: CheckpointStore[] = []) {}
  async available(): Promise<boolean> {
    return true;
  }
  async get<T>(key: string): Promise<T | undefined> {
    const row = this.rows.get(key);
    if (!row || (row.expiresAt != null && row.expiresAt <= Date.now())) return;
    return structuredClone(row.value) as T;
  }
  async put<T>(
    key: string,
    value: T,
    options: AccessRowOptions = {}
  ): Promise<void> {
    this.rows.set(key, { value: structuredClone(value), ...options });
  }
  async remove(key: string): Promise<void> {
    this.rows.delete(key);
  }
  async purge(accountId: string): Promise<void> {
    for (const [key, row] of this.rows)
      if (row.accountId === accountId) this.rows.delete(key);
  }
  async atomic<T>(fn: () => Promise<T>): Promise<T> {
    if (this.context.getStore()) return fn();
    const previous = this.queue;
    let release!: () => void;
    this.queue = new Promise<void>((done) => {
      release = done;
    });
    await previous;
    const rows = structuredClone(this.rows);
    const rollbacks = this.participants.map((store) => store.checkpoint());
    try {
      return await this.context.run(true, fn);
    } catch (error) {
      this.rows = rows;
      for (const rollback of rollbacks.reverse()) rollback();
      throw error;
    } finally {
      release();
    }
  }
}
