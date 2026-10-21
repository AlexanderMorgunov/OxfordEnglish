import { z } from 'zod';
import { db } from '@/db/db';
import { captureDataScope, requireDataScope } from '@/features/account/dataScope';

const normalize = (value: string) => value.trim().replace(/\s+/g, ' ').replace(/[’‘]/g, "'");
export const RussianTermSchema = z.string().max(160).refine(value => !/[\r\n]/.test(value))
  .transform(normalize).pipe(z.string().min(1).max(80).regex(/^[А-Яа-яЁё]+(?:[ '-][А-Яа-яЁё]+)*$/));
export const EnglishDraftSchema = z.string().max(160).refine(value => !/[\r\n]/.test(value))
  .transform(normalize).pipe(z.string().min(1).max(80).regex(/^[A-Za-z]+(?:[ '-][A-Za-z]+)*$/));
export const RussianAnswerSchema = z.string().trim().min(1).max(120).refine(value => /[А-Яа-яЁё]/.test(value));
export const RU_ENTRY_PREFIX = 'lens:ru-en:v1 ';
export const RU_ENTRY_TTL = 7 * 24 * 60 * 60 * 1000;
const SOURCE = 'lens-ru-en';
const CacheSchema = z.object({ version: z.literal('v1'), at: z.number().finite(), english: EnglishDraftSchema }).strict();
const ProviderSchema = z.object({ responseStatus: z.literal(200), responseDetails: z.string().max(1000).optional(), quotaFinished: z.boolean().optional(), responseData: z.object({ translatedText: z.string().max(200) }) });
export type RussianProposal = { russian: string; english: string; cached: boolean };

async function limitedBody(response: Response, signal: AbortSignal): Promise<string> {
  if (!response.body) throw new Error('Translation unavailable');
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  try {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
    while (true) {
      const chunk = await reader.read();
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 32768) { cancel(); throw new Error('Translation unavailable'); }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) { cancel(); throw error; }
  finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
}

export async function translateRussianTerm(raw: string, signal: AbortSignal): Promise<RussianProposal> {
  const russian = RussianTermSchema.parse(raw);
  const key = `${RU_ENTRY_PREFIX}${russian}`;
  const current = captureDataScope();
  const controller = new AbortController();
  const abort = () => controller.abort();
  const active = () => {
    requireDataScope(current);
    if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  const timer = setTimeout(abort, 8000);
  let rejectAbort: (reason: Error) => void = () => {};
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const onAbort = () => rejectAbort(new DOMException('Aborted', 'AbortError'));
  controller.signal.addEventListener('abort', onAbort, { once: true });
  const work = async (): Promise<RussianProposal> => {
    active();
    try {
      const row = await db.translations.get(key);
      active();
      if (row?.source === SOURCE) {
        const cached = CacheSchema.parse(JSON.parse(row.ru));
        const age = Date.now() - cached.at;
        if (age >= 0 && age < RU_ENTRY_TTL) return { russian, english: cached.english, cached: true };
      }
    } catch { active(); }
    active();
    const response = await fetch(`https://api.mymemory.translated.net/get?${new URLSearchParams({ q: russian, langpair: 'ru|en' })}`, { signal: controller.signal });
    active();
    if (!response.ok) { void response.body?.cancel().catch(() => {}); throw new Error('Translation unavailable'); }
    const text = await limitedBody(response, controller.signal);
    active();
    const data = ProviderSchema.parse(JSON.parse(text));
    if (data.quotaFinished || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(`${data.responseDetails ?? ''} ${data.responseData.translatedText}`)) throw new Error('Translation unavailable');
    const english = EnglishDraftSchema.parse(data.responseData.translatedText.trim().replace(/[.!?]$/, ''));
    try {
      await db.transaction('rw', db.translations, async () => {
        active();
        const previous = await db.translations.get(key);
        active();
        if (previous && previous.source !== SOURCE) return;
        await db.translations.put({ word: key, source: SOURCE, ru: JSON.stringify({ version: 'v1', at: Date.now(), english }) });
        active();
        const rows = await db.translations.where('word').startsWith(RU_ENTRY_PREFIX).toArray();
        const dated = rows.filter(row => row.source === SOURCE).map(row => {
          try { return { key: row.word, at: CacheSchema.parse(JSON.parse(row.ru)).at }; }
          catch { return { key: row.word, at: 0 }; }
        }).sort((a, b) => b.at - a.at);
        const expired = dated.filter((row, index) => index >= 100 || Date.now() - row.at >= RU_ENTRY_TTL || row.at > Date.now());
        if (expired.length) await db.translations.bulkDelete(expired.map(row => row.key));
        active();
      });
    } catch { active(); }
    active();
    return { russian, english, cached: false };
  };
  try {
    return await Promise.race([work(), cancelled]);
  } finally {
    controller.abort();
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
