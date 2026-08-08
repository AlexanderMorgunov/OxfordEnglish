import { db } from '@/db/db';

type MyMemoryResponse = { responseData?: { translatedText?: string } };

/**
 * Translate a single English word to Russian on demand, cached in IndexedDB.
 * Uses MyMemory (free, no key). Returns null when offline or on failure —
 * curated glossary translations stay the offline-first path.
 */
export async function translateWord(word: string): Promise<string | null> {
  const w = word.toLowerCase();
  try {
    const cached = await db.translations.get(w);
    if (cached) return cached.ru;
  } catch {
    // ignore cache miss
  }
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(w)}&langpair=en|ru`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as MyMemoryResponse;
    const ru = data.responseData?.translatedText?.trim();
    if (!ru) return null;
    try {
      await db.translations.put({ word: w, ru, source: 'mymemory' });
    } catch {
      // best-effort cache
    }
    return ru;
  } catch {
    return null;
  }
}
