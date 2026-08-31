import { WORD_SPLIT_RE, WORD_TEST_RE } from '@/shared/lib/audio';

/** Canonical identity of a saved phrase: its word tokens, lowercased, single-space joined. Both the
 *  saved-phrase Set and the sentence matcher key on this, so a tap-selected phrase (keeps internal
 *  punctuation) and a drag-selected one (arbitrary `toString`) collapse to the same key. */
export function phraseKey(text: string): string {
  return text
    .split(WORD_SPLIT_RE)
    .filter((t) => WORD_TEST_RE.test(t))
    .map((t) => t.toLowerCase())
    .join(' ');
}

/**
 * Token indices (into `sentence.split(WORD_SPLIT_RE)`) that fall inside any saved phrase, so the
 * reader can underline a saved phrase in place. Matches whole word-token runs only (`train` never
 * matches inside `trainer`), case-insensitively; multi-word phrases only (single words use word
 * status). Only the phrase's word slots are marked — the render styles word tokens, not punctuation.
 */
export function phraseMarkedTokens(sentence: string, phraseKeys: Set<string>): Set<number> {
  const marked = new Set<number>();
  if (phraseKeys.size === 0) return marked;
  const phrases = [...phraseKeys]
    .map((k) => (k ? k.split(' ') : []))
    .filter((w) => w.length >= 2);
  if (phrases.length === 0) return marked;

  const parts = sentence.split(WORD_SPLIT_RE);
  const words: { slot: number; w: string }[] = [];
  parts.forEach((p, i) => {
    if (WORD_TEST_RE.test(p)) words.push({ slot: i, w: p.toLowerCase() });
  });

  for (let start = 0; start < words.length; start += 1) {
    for (const pw of phrases) {
      if (start + pw.length > words.length) continue;
      let ok = true;
      for (let k = 0; k < pw.length; k += 1) {
        if (words[start + k]!.w !== pw[k]) {
          ok = false;
          break;
        }
      }
      if (ok) for (let k = 0; k < pw.length; k += 1) marked.add(words[start + k]!.slot);
    }
  }
  return marked;
}
