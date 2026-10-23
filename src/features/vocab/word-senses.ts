import { z } from 'zod';
import { db } from '@/db/db';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { managedAiAvailable, planUnreadable } from '@/features/account/entitlement';
import { complete, PROVIDERS } from '@/features/ai/provider';
import type { AiConfig } from '@/features/ai/provider';
import { runTaskResult, captureAiScope } from '@/features/ai/route';
import type { AiPath } from '@/features/ai/route';
import { isConfigured } from '@/features/ai/store';
import { SenseTermSchema, SENSES_VERSION, SENSES_MAX_TOKENS, completeWordSenses, parseWordSenses } from '@/features/ai/word-senses';
import type { WordSense } from '@/features/ai/word-senses';

export const SENSE_CACHE_PREFIX = `lens:senses:${SENSES_VERSION} `;
export const SENSE_CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const CACHE_LIMIT = 100;
const CacheSchema = z.object({ version: z.literal(SENSES_VERSION), at: z.number().finite(), path: z.enum(['managed', 'byok']), content: z.string().max(4096) }).strict();
export type SenseResult = { senses: WordSense[]; path: AiPath; cached: boolean };

const guard = (current: () => boolean, signal?: AbortSignal) => {
  requireDataScope(current);
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

async function identity(config: AiConfig): Promise<string> {
  const endpoint = (config.baseUrl || PROVIDERS[config.provider].baseUrl).replace(/\/$/, '');
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([config.provider, endpoint, config.model])));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function keys(term: string, config: AiConfig | null, current: () => boolean, signal?: AbortSignal) {
  guard(current, signal);
  const suffix = SenseTermSchema.parse(term);
  const managed = `${SENSE_CACHE_PREFIX}managed:${suffix}`;
  const byok = isConfigured(config) && config ? `${SENSE_CACHE_PREFIX}byok:${await identity(config)}:${suffix}` : null;
  guard(current, signal);
  return { managed, byok };
}

async function readCache(key: string, term: string, path: AiPath, current: () => boolean, signal?: AbortSignal): Promise<SenseResult | null> {
  guard(current, signal);
  try {
    const row = await db.translations.get(key);
    guard(current, signal);
    if (row?.source !== 'lens-word-senses') return null;
    const cached = CacheSchema.parse(JSON.parse(row.ru));
    const age = Date.now() - cached.at;
    if (cached.path !== path || age < 0 || age >= SENSE_CACHE_TTL) return null;
    return { senses: parseWordSenses(cached.content, term), path, cached: true };
  } catch {
    guard(current, signal);
    return null;
  }
}

export async function cachedWordSenses(term: string, config: AiConfig | null, signal?: AbortSignal): Promise<SenseResult | null> {
  const current = captureDataScope();
  const names = await keys(term, config, current, signal);
  const preferManaged = managedAiAvailable() || planUnreadable() || !names.byok;
  const candidates: [string, AiPath][] = preferManaged ? [[names.managed, 'managed']] : [];
  if (names.byok) candidates.push([names.byok, 'byok']);
  if (!preferManaged) candidates.push([names.managed, 'managed']);
  for (const [key, path] of candidates) {
    const result = await readCache(key, term, path, current, signal);
    guard(current, signal);
    if (result) return result;
  }
  return null;
}

export async function requestWordSenses(term: string, config: AiConfig | null, signal: AbortSignal): Promise<SenseResult> {
  const requireActive = captureAiScope(signal);
  const dataCurrent = captureDataScope();
  const current = () => { requireActive(); return dataCurrent(); };
  guard(current, signal);
  const query = SenseTermSchema.parse(term);
  const preferred: AiPath = managedAiAvailable() || planUnreadable() ? 'managed' : 'byok';
  const cached = await cachedWordSenses(query, config, signal);
  guard(current, signal);
  if (cached) return cached;
  if (preferred === 'byok' && !isConfigured(config)) throw new Error('AI unavailable');
  const names = await keys(query, config, current, signal);
  guard(current, signal);
  const result = await runTaskResult({ task: 'wordSenses', term: query }, config, (c, signal) => completeWordSenses(query, (messages, bounded) => complete(c, messages, {
    temperature: 0.2, maxTokens: SENSES_MAX_TOKENS, noReasoning: true, signal: bounded,
  }), signal), { path: preferred, signal });
  guard(current, signal);
  const { path, content } = result;
  const senses = parseWordSenses(content, query);
  const key = path === 'managed' ? names.managed : names.byok;
  if (key) {
    try {
      await db.transaction('rw', db.translations, async () => {
        guard(current, signal);
        const existing = await db.translations.get(key);
        guard(current, signal);
        if (existing && existing.source !== 'lens-word-senses') return;
        await db.translations.put({ word: key, source: 'lens-word-senses', ru: JSON.stringify({
          version: SENSES_VERSION, at: Date.now(), path, content: JSON.stringify({ senses }),
        }) });
        guard(current, signal);
        const rows = await db.translations.where('word').startsWith(SENSE_CACHE_PREFIX).toArray();
        const dated = rows.filter(row => row.source === 'lens-word-senses').map(row => {
          try { return { key: row.word, at: CacheSchema.parse(JSON.parse(row.ru)).at }; }
          catch { return { key: row.word, at: 0 }; }
        }).sort((a, b) => b.at - a.at);
        const expired = dated.filter((row, index) => index >= CACHE_LIMIT || Date.now() - row.at >= SENSE_CACHE_TTL || row.at > Date.now());
        if (expired.length) await db.translations.bulkDelete(expired.map(row => row.key));
        guard(current, signal);
      });
    } catch {
      guard(current, signal);
    }
  }
  guard(current, signal);
  return { senses, path, cached: false };
}
