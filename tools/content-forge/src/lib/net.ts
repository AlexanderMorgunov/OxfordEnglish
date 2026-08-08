import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR } from './paths.ts';

const UA = 'content-forge/0.1 (personal language-learning project)';

/** Disk cache keyed by request — avoids hammering free public APIs while iterating. */
export async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const file = join(
    CACHE_DIR,
    createHash('sha256').update(key).digest('hex').slice(0, 32) + '.json'
  );
  if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;
  const value = await fn();
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(value));
  return value;
}

let lastRequest = 0;

/** Polite client: 1 req/s floor, exponential backoff on 429/5xx. */
export async function politeFetch(
  url: string,
  init?: RequestInit
): Promise<Response> {
  const gap = Date.now() - lastRequest;
  if (gap < 1000) await new Promise((r) => setTimeout(r, 1000 - gap));
  lastRequest = Date.now();

  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      ...init,
      headers: { 'User-Agent': UA, ...init?.headers },
    });
    if (res.status !== 429 && res.status < 500) return res;
    await new Promise((r) => setTimeout(r, 2 ** attempt * 1500));
  }
  throw new Error(`request failed after retries: ${url}`);
}
