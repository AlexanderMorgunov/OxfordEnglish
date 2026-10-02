import { db } from '@/db/db';
import { toSentences } from '@/features/reader/parse/text';
import { captureDataScope } from '@/features/account/dataScope';

type MyMemoryResponse = { responseData?: { translatedText?: string } };

const MM_LIMIT = 480; // MyMemory anonymous per-request character cap

/** A real en→ru translation is Cyrillic; a Latin result means MyMemory echoed the source. */
const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

export const termCacheKey = (term: string): string => term.trim().toLowerCase();

async function cacheAutomatic(
  key: string,
  ru: string,
  current: () => boolean
): Promise<string | null> {
  if (!current()) return null;
  try {
    return await db.transaction('rw', db.translations, async () => {
      const existing = await db.translations.get(key);
      if (!current()) return null;
      if (existing?.source === 'manual') return existing.ru || null;
      await db.translations.put({ word: key, ru, source: 'mymemory' });
      return ru;
    });
  } catch {
    return current() ? ru : null;
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

async function translateParts(parts: string[], key: string, current: () => boolean): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const out: string[] = [];
    for (const part of parts) {
      if (!current() || controller.signal.aborted) return null;
      const ru = await mymemory(part, controller.signal);
      if (ru === null || !current()) return null;
      out.push(ru);
    }
    return cacheAutomatic(key, out.join(' '), current);
  } finally {
    clearTimeout(timeout);
  }
}

/** Group sentences into chunks that fit MyMemory's per-request limit. */
function chunk(text: string): string[] {
  if (text.length <= MM_LIMIT) return [text];
  const chunks: string[] = [];
  let buf = '';
  for (const s of toSentences(text)) {
    if (buf && buf.length + s.length + 1 > MM_LIMIT) {
      chunks.push(buf);
      buf = '';
    }
    buf = buf ? `${buf} ${s}` : s;
    if (buf.length > MM_LIMIT) {
      chunks.push(buf.slice(0, MM_LIMIT));
      buf = buf.slice(MM_LIMIT);
    }
  }
  if (buf) chunks.push(buf);
  return chunks;
}

/**
 * Translate a paragraph or phrase to Russian on demand (MyMemory, free, no key), cached
 * in IndexedDB. Long text is split by sentence to fit the request limit. Null on failure
 * so the caller can show a plain "unavailable" state (offline-first, degrade visibly).
 */
export async function translateText(text: string): Promise<string | null> {
  const source = text.trim();
  const key = termCacheKey(source);
  const current = captureDataScope();
  if (!source) return null;
  try {
    const cached =
      (await db.translations.get(key)) ?? (await db.translations.get(source));
    if (!current()) return null;
    if (cached?.source === 'manual') return cached.ru || null;
    if (cached && hasCyrillic(cached.ru)) return cached.ru;
  } catch {
    // ignore cache miss
  }
  if (!current()) return null;
  return translateParts(chunk(source), key, current);
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
  return translateParts([w], w, current);
}
