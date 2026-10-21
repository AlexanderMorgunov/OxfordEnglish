import { db } from '@/db/db';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';
import { translationChunks } from './translation-chunks';

type MyMemoryResponse = { responseData?: { translatedText?: string } };

/** A real en→ru translation is Cyrillic; a Latin result means MyMemory echoed the source. */
const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

export const termCacheKey = (term: string): string => term.trim().toLowerCase();

async function cacheAutomatic(
  key: string,
  ru: string,
  current: () => boolean,
  signal: AbortSignal
): Promise<string | null> {
  if (!current() || signal.aborted) return null;
  try {
    return await db.transaction('rw', db.translations, async () => {
      const existing = await db.translations.get(key);
      if (!current() || signal.aborted) return null;
      if (existing?.source === 'manual') return existing.ru || null;
      await db.translations.put({ word: key, ru, source: 'mymemory' });
      requireDataScope(current);
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      return ru;
    });
  } catch {
    return current() && !signal.aborted ? ru : null;
  }
}

async function mymemory(text: string, signal: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`,
      { signal }
    );
    if (!res.ok) return null;
    const data = (await res.json()) as MyMemoryResponse;
    const ru = data.responseData?.translatedText?.trim();
    // Reject the daily-limit warning, the length-limit note, and any non-Russian echo.
    if (signal.aborted || !ru || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(ru) || !hasCyrillic(ru)) return null;
    return ru;
  } catch {
    return null;
  }
}

type TranslationPart = { text: string; separator: string };
export type TranslationProgress = { completed: number; total: number };
type PassageProgressOptions = {
  onProgress?: (text: string, progress: TranslationProgress) => void;
  resume?: Map<string, string>;
};

async function translateParts(parts: TranslationPart[], key: string, current: () => boolean, signal?: AbortSignal, cache = true, progress: PassageProgressOptions = {}): Promise<string | null> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const out: string[] = [];
    for (const [index, part] of parts.entries()) {
      if (!current() || controller.signal.aborted) return null;
      const ru = progress.resume?.get(part.text) ?? await mymemory(part.text, controller.signal);
      if (ru === null || !current() || controller.signal.aborted) return null;
      out.push(part.separator + ru);
      progress.resume?.set(part.text, ru);
      progress.onProgress?.(out.join(''), { completed: index + 1, total: parts.length });
    }
    if (!current() || controller.signal.aborted) return null;
    return cache ? await cacheAutomatic(key, out.join(''), current, controller.signal) : out.join('');
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

/** A proposal is deliberately separate from the user's saved/manual answer. */
export async function translateTermProposal(term: string, opts: { signal?: AbortSignal; fresh?: boolean } = {}): Promise<string | null> {
  const source = term.trim();
  const key = termCacheKey(source);
  const current = captureDataScope();
  if (!source || opts.signal?.aborted) return null;
  if (!opts.fresh) {
    try {
      const cached = await db.translations.get(key);
      if (!current() || opts.signal?.aborted) return null;
      if (cached?.source !== 'manual' && cached?.ru && hasCyrillic(cached.ru)) return cached.ru;
    } catch {
      // A failed local read does not prevent an explicit provider lookup.
    }
  }
  return translateParts(translationChunks(source).map((text, i) => ({ text, separator: i ? ' ' : '' })), key, current, opts.signal, false);
}

/**
 * Translate a paragraph or phrase to Russian on demand (MyMemory, free, no key), cached
 * in IndexedDB. Long text is split by sentence to fit the request limit. Null on failure
 * so the caller can show a plain "unavailable" state (offline-first, degrade visibly).
 */
export async function translateText(text: string, opts: { signal?: AbortSignal; mode?: 'term' | 'passage' } & PassageProgressOptions = {}): Promise<string | null> {
  const source = text.trim();
  const passage = opts.mode === 'passage';
  const key = passage ? `text-workbench:free: ${source}` : termCacheKey(source);
  const current = captureDataScope();
  if (!source || opts.signal?.aborted) return null;
  const paragraphs = passage ? source.split(/\n{2,}/).filter(Boolean) : [source];
  const parts = paragraphs.flatMap((paragraph, p) => translationChunks(paragraph).map((part, i) => ({
    text: part, separator: i ? ' ' : p ? '\n\n' : '',
  })));
  opts.onProgress?.('', { completed: 0, total: parts.length });
  const cachedResult = (ru: string | null) => {
    if (ru) opts.onProgress?.(ru, { completed: parts.length, total: parts.length });
    return current() && !opts.signal?.aborted ? ru : null;
  };
  try {
    const cached =
      (await db.translations.get(key)) ?? (passage ? undefined : await db.translations.get(source));
    if (!current() || opts.signal?.aborted) return null;
    if (cached?.source === 'manual') return cachedResult(cached.ru || null);
    if (cached && hasCyrillic(cached.ru)) return cachedResult(cached.ru);
  } catch {
    // ignore cache miss
  }
  if (!current() || opts.signal?.aborted) return null;
  return translateParts(parts, key, current, opts.signal, true, opts);
}

/**
 * Translate a single English word to Russian on demand, cached in IndexedDB.
 * Uses MyMemory (free, no key). Returns null when offline or on failure —
 * curated glossary translations stay the offline-first path.
 */
export async function translateWord(word: string): Promise<string | null> {
  const w = termCacheKey(word);
  const current = captureDataScope();
  if (!w) return null;
  try {
    const cached = await db.translations.get(w);
    if (!current()) return null;
    if (cached?.source === 'manual') return cached.ru || null;
    if (cached && hasCyrillic(cached.ru)) return cached.ru;
  } catch {
    // ignore cache miss
  }
  if (!current()) return null;
  return translateParts(translationChunks(w).map((text, i) => ({ text, separator: i ? ' ' : '' })), w, current);
}
