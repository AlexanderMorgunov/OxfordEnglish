import { translateText } from '@/features/vocab/translate';
import { aiTranslate } from '@/features/ai/functions';
import { captureAiScope, type AiPath } from '@/features/ai/route';
import type { AiConfig } from '@/features/ai/provider';
import { captureDataScope } from '@/features/account/dataScope';
import { abortReason } from '@/shared/lib/deadline';

export type ReaderTranslation = { text: string; contextual: boolean; source?: AiPath | 'free' };

/**
 * Translate a reader sentence/phrase EN→RU. Uses available AI when enabled,
 * falling back to the free (MyMemory) path on any AI failure (offline, refusal, a
 * non-Russian result). Returns null when both are unavailable so the caller shows "unavailable".
 */
export async function translateReaderText(
  text: string,
  opts: { ai: boolean; config: AiConfig | null; sentence?: string; signal?: AbortSignal }
): Promise<string | null> {
  return (await translateReaderResult(text, opts))?.text ?? null;
}

export async function translateReaderResult(
  text: string,
  opts: { ai: boolean; config: AiConfig | null; sentence?: string; signal?: AbortSignal }
): Promise<ReaderTranslation | null> {
  const current = captureDataScope();
  const aiActive = captureAiScope(opts.signal);
  const requireActive = () => {
    if (opts.ai) aiActive();
    else if (opts.signal?.aborted) throw abortReason(opts.signal);
  };
  requireActive();
  if (opts.ai) {
    try {
      let source: AiPath | undefined;
      const ru = await aiTranslate(opts.config, text, { sentence: opts.sentence, signal: opts.signal, onSource: path => { source = path; } });
      requireActive();
      if (!current()) return null;
      if (ru)
        return {
          text: ru, source,
          contextual: Boolean(
            opts.sentence?.trim() && opts.sentence.trim() !== text.trim()
          ),
        };
    } catch {
      // fall through to the free translator
    }
  }
  if (!current()) return null;
  requireActive();
  const ru = await translateText(text, { signal: opts.signal });
  requireActive();
  return ru && current() ? { text: ru, contextual: false, source: 'free' } : null;
}
