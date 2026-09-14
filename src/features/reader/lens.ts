import type { AiConfig } from '@/features/ai/provider';
import type { Level } from '@/content/schema';
import { aiSimplify, aiGrammar } from '@/features/ai/functions';
import { clampBand } from '@/features/ai/simplify-prompts';
import { translateReaderText } from './translate';

/**
 * A per-sentence reader "lens": one AI-or-service call on a sentence, rendered inline. Translate (EN→RU),
 * Simplify (same-language rewrite at the learner's CEFR band), and Grammar (RU explanation of the one
 * salient structure). Adding a mode is a new prompt + a `runLens` branch — no new reader plumbing.
 */
export type LensMode = 'translate' | 'simplify' | 'grammar';

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
  if (lens === 'translate') return `translate:${a.ai ? 'ai' : 'free'}`;
  return `${lens}:${clampBand(a.level, 0)}`; // simplify / grammar both carry the band/level dimension
}

/**
 * Run one lens on one sentence. Returns `null` when unavailable (offline, no AI at all, or the model
 * failed) so the caller can show the fallback affordance. `stepDown` walks the simplify band toward A1.
 *
 * Deliberately does NOT gate on `a.config`: that is the BYOK key, and since the managed-AI path landed,
 * `aiSimplify`/`aiGrammar` take `AiConfig | null` and route through the server for a subscriber who has
 * no key of their own. Gating here meant the lens menu — shown on `useAiEnabled`, which counts the
 * subscription — offered buttons that silently did nothing for exactly the people who paid.
 */
export async function runLens(mode: LensMode, text: string, a: LensArgs, stepDown = 0): Promise<string | null> {
  if (mode === 'translate') return translateReaderText(text, { ai: a.ai, config: a.config });
  try {
    return mode === 'grammar'
      ? await aiGrammar(a.config, text, { level: a.level })
      : await aiSimplify(a.config, text, { level: a.level, stepDown });
  } catch {
    return null;
  }
}
