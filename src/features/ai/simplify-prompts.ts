import type { Level } from '@/content/schema';

/** Bump when a prompt changes so the cache (keyed with it) invalidates instead of serving stale output. */
export const SIMPLIFY_PROMPT_VERSION = 'v1';

/** The four target bands, ordered easy→hard. `stepDown` walks this array toward A1. */
export const BANDS = ['A1', 'A2', 'B1', 'B2'] as const;
export type Band = (typeof BANDS)[number];

/** Learner Level → target Band, then step down `stepDown` bands (floor A1). C1/C2 clamp to B2
 *  (simplifying "to C1" is meaningless); a null/undefined level (placement not done) defaults to B1. */
export function clampBand(level: Level | null | undefined, stepDown = 0): Band {
  const base: Band =
    level === 'A1' ? 'A1' : level === 'A2' ? 'A2' : level === 'B2' || level === 'C1' || level === 'C2' ? 'B2' : 'B1';
  return BANDS[Math.max(0, BANDS.indexOf(base) - Math.max(0, stepDown))] ?? 'A1';
}

type BandRule = { maxSentences: number; words: number; vocab: string; grammar: string; exIn: string; exOut: string };

const RULES: Record<Band, BandRule> = {
  A1: {
    maxSentences: 3,
    words: 8,
    vocab: 'Use only very common words — the Oxford 3000 A1 band (about the 900 most basic English words).',
    grammar:
      'Use only present simple, present continuous, and "going to" future. No passive voice, no relative clauses, no perfect tenses. One clause per sentence.',
    exIn: 'Having finished his supper, the old fisherman trudged wearily home.',
    exOut: 'The old fisherman finished his dinner. Then he walked home. He was very tired.',
  },
  A2: {
    maxSentences: 3,
    words: 12,
    vocab: 'Use common words from the Oxford 3000 A1–A2 bands (about the 2000 most common English words).',
    grammar:
      'Allowed: past simple, present perfect, comparatives, and "because / but / when" clauses. Avoid passive voice, reported speech, and participle clauses.',
    exIn: 'Scarcely had the vessel departed when the tempest descended upon the harbour.',
    exOut: 'The ship left. Then a big storm came to the harbour.',
  },
  B1: {
    maxSentences: 3,
    words: 16,
    vocab: 'Use words from the Oxford 3000 (A1–B1 bands). Replace literary, archaic, or low-frequency words with everyday equivalents.',
    grammar: 'Most structures are fine, but avoid inversion, participle clauses, and nested relative clauses. Prefer active voice.',
    exIn: 'Not until the letter arrived did she comprehend the magnitude of her error.',
    exOut: 'She understood how serious her mistake was only when the letter arrived.',
  },
  B2: {
    maxSentences: 3,
    words: 20,
    vocab: 'Use words from the Oxford 3000/5000 up to B2. Replace archaic, dialectal, and very literary vocabulary; keep neutral-formal vocabulary as is.',
    grammar: 'Keep natural complex grammar; only unwind heavily literary syntax (inversion, long periodic sentences, chains of subordinate clauses).',
    exIn: 'The old mariner, his visage weathered, did resolve to quit the sea forthwith.',
    exOut: 'The old sailor, with his weathered face, decided to leave the sea at once.',
  },
};

/** Constant system prompt per band (byte-identical → provider prefix-cache can hit). The worked example
 *  is delivered as a separate user/assistant turn (see `simplifyShot`), NOT inlined here — an inline
 *  "A -> B" invites the model to continue the pattern and run away. */
export function simplifySystem(band: Band): string {
  const r = RULES[band];
  return [
    `You rewrite ONE English sentence for an English learner at CEFR level ${band}.`,
    'Rules:',
    '1. Keep the meaning EXACTLY. Never add facts, opinions, or new information. Keep all names, numbers, dates, and negations unchanged.',
    '2. Reply with ONLY the rewritten sentence(s) in English — no quotes, no markdown, no explanation, no preamble, no notes. Then stop.',
    `3. You may split one long sentence into up to ${r.maxSentences} short sentences of about ${r.words} words each.`,
    `4. ${r.vocab}`,
    `5. ${r.grammar}`,
    '6. If a rare word is essential (a technical term, a key object), keep it and add a short gloss in dashes: "the harpoon — a spear for hunting whales".',
    `7. If the sentence is already simple enough for ${band}, return it unchanged.`,
  ].join('\n');
}

/** The one worked example for a band, as a completed user→assistant exchange the caller prepends as
 *  few-shot turns. Teaches "given a sentence, reply with just the rewrite and stop". */
export function simplifyShot(band: Band): { src: string; out: string } {
  return { src: RULES[band].exIn, out: RULES[band].exOut };
}
