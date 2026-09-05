import type { AiConfig } from '@/features/ai/provider';
import type { Level } from '@/content/schema';
import { aiSimplify } from '@/features/ai/functions';
import { clampBand } from '@/features/ai/simplify-prompts';
import { translateReaderText } from './translate';

/**
 * A per-sentence reader "lens": one AI-or-service call on a sentence, rendered inline. Translate (EN→RU)
 * and Simplify (same-language rewrite at the learner's CEFR band) are the two modes today; a grammar
 * explainer is the natural third and slots in here with a new mode + system prompt, no new reader plumbing.
 */
export type LensMode = 'translate' | 'simplify';

export type LensArgs = {
  /** Translate sub-mode: BYOK AI vs the free MyMemory service. */
  ai: boolean;
  config: AiConfig | null;
  /** Learner CEFR level (from placement) — the simplify target band; null → B1 default. */
  level: Level | null;
};

/**
 * A PRIMITIVE key for the active lens config, so a memoized `Paragraph` re-renders — and its per-sentence
 * result cells segment — when the mode, the translate sub-mode, or the simplify band changes. Step-down is
 * not part of it (it's per-tap, not a global switch).
 */
export function lensKey(lens: LensMode, a: LensArgs): string {
  return lens === 'translate' ? `translate:${a.ai ? 'ai' : 'free'}` : `simplify:${clampBand(a.level, 0)}`;
}

/**
 * Run one lens on one sentence. Returns `null` when unavailable (offline, no AI key, or the model failed)
 * so the caller can show the fallback affordance. `stepDown` walks the simplify band toward A1.
 */
export async function runLens(mode: LensMode, text: string, a: LensArgs, stepDown = 0): Promise<string | null> {
  if (mode === 'translate') return translateReaderText(text, { ai: a.ai, config: a.config });
  if (!a.config) return null;
  try {
    return await aiSimplify(a.config, text, { level: a.level, stepDown });
  } catch {
    return null;
  }
}
