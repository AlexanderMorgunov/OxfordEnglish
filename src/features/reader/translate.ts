import { translateText } from '@/features/vocab/translate';
import { aiTranslate } from '@/features/ai/functions';
import { aiAvailable } from '@/features/ai/route';
import type { AiConfig } from '@/features/ai/provider';

/**
 * Translate a reader sentence/phrase EN→RU. Uses the BYOK AI when the user enabled it AND a key is
 * configured, falling back to the free (MyMemory) path on any AI failure (offline, refusal, a
 * non-Russian result). Returns null when both are unavailable so the caller shows "unavailable".
 */
export async function translateReaderText(
  text: string,
  opts: { ai: boolean; config: AiConfig | null; sentence?: string }
): Promise<string | null> {
  if (opts.ai && aiAvailable(opts.config)) {
    try {
      const ru = await aiTranslate(opts.config, text, { sentence: opts.sentence });
      if (ru) return ru;
    } catch {
      // fall through to the free translator
    }
  }
  return translateText(text);
}
