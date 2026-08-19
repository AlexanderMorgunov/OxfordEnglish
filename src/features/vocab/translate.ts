import { db } from '@/db/db';
import { toSentences } from '@/features/reader/parse/text';

type MyMemoryResponse = { responseData?: { translatedText?: string } };

const MM_LIMIT = 480; // MyMemory anonymous per-request character cap

/** A real en→ru translation is Cyrillic; a Latin result means MyMemory echoed the source. */
const hasCyrillic = (s: string) => /[а-яё]/i.test(s);

async function mymemory(text: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=en|ru`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as MyMemoryResponse;
    const ru = data.responseData?.translatedText?.trim();
    // Reject the daily-limit warning, the length-limit note, and any non-Russian echo.
    if (!ru || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(ru) || !hasCyrillic(ru)) return null;
    return ru;
  } catch {
    return null;
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
  const key = text.trim();
  if (!key) return null;
  try {
    const cached = await db.translations.get(key);
    if (cached && hasCyrillic(cached.ru)) return cached.ru; // skip stale bad caches
  } catch {
    // ignore cache miss
  }
  const parts = chunk(key);
  const out: string[] = [];
  for (const part of parts) {
    const ru = await mymemory(part);
    if (ru === null) return null;
    out.push(ru);
  }
  const ru = out.join(' ');
  try {
    await db.translations.put({ word: key, ru, source: 'mymemory' });
  } catch {
    // best-effort cache
  }
  return ru;
}

/**
 * Translate a single English word to Russian on demand, cached in IndexedDB.
 * Uses MyMemory (free, no key). Returns null when offline or on failure —
 * curated glossary translations stay the offline-first path.
 */
export async function translateWord(word: string): Promise<string | null> {
  const w = word.toLowerCase();
  try {
    const cached = await db.translations.get(w);
    if (cached && hasCyrillic(cached.ru)) return cached.ru; // skip stale bad caches (source echoes, warnings)
  } catch {
    // ignore cache miss
  }
  const ru = await mymemory(w);
  if (ru === null) return null; // offline, daily limit, or a non-Russian echo — degrade visibly
  try {
    await db.translations.put({ word: w, ru, source: 'mymemory' });
  } catch {
    // best-effort cache
  }
  return ru;
}
