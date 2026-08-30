import { translateText } from '@/features/vocab/translate';
import { aiTranslate } from '@/features/ai/functions';
import { isConfigured } from '@/features/ai/store';
import type { AiConfig } from '@/features/ai/provider';

/**
 * Translate a reader sentence/phrase EN→RU. Uses the BYOK AI when the user enabled it AND a key is
 * configured, falling back to the free (MyMemory) path on any AI failure (offline, refusal, a
 * non-Russian result). Returns null when both are unavailable so the caller shows "unavailable".
 */
export async function translateReaderText(
  text: string,
  opts: { ai: boolean; config: AiConfig | null }
): Promise<string | null> {
  if (opts.ai && isConfigured(opts.config)) {
    try {
      const ru = await aiTranslate(opts.config, text);
      if (ru) return ru;
    } catch {
      // fall through to the free translator
    }
  }
  return translateText(text);
}
