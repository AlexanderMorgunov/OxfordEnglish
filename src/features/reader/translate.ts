import { translateText } from '@/features/vocab/translate';
import { aiTranslate } from '@/features/ai/functions';
import { aiAvailable } from '@/features/ai/route';
import type { AiConfig } from '@/features/ai/provider';
import { captureDataScope } from '@/features/account/dataScope';

export type ReaderTranslation = { text: string; contextual: boolean };

/**
 * Translate a reader sentence/phrase EN→RU. Uses available AI when enabled,
 * falling back to the free (MyMemory) path on any AI failure (offline, refusal, a
 * non-Russian result). Returns null when both are unavailable so the caller shows "unavailable".
 */
export async function translateReaderText(
  text: string,
  opts: { ai: boolean; config: AiConfig | null; sentence?: string }
): Promise<string | null> {
  return (await translateReaderResult(text, opts))?.text ?? null;
}

export async function translateReaderResult(
  text: string,
  opts: { ai: boolean; config: AiConfig | null; sentence?: string }
): Promise<ReaderTranslation | null> {
  const current = captureDataScope();
  if (opts.ai && aiAvailable(opts.config)) {
    try {
      const ru = await aiTranslate(opts.config, text, { sentence: opts.sentence });
      if (!current()) return null;
      if (ru)
        return {
          text: ru,
          contextual: Boolean(
            opts.sentence?.trim() && opts.sentence.trim() !== text.trim()
          ),
        };
    } catch {
      // fall through to the free translator
    }
  }
  if (!current()) return null;
  const ru = await translateText(text);
  return ru && current() ? { text: ru, contextual: false } : null;
}
