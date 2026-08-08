const SMART_QUOTES = /[‘’‛′]/g; // ' ' ‛ ′  → '
const SMART_DQUOTES = /[“”″]/g; //     " " ″  → "
const TRAILING_PUNCT = /[.!?]+$/;

export type NormalizeOptions = { caseSensitive?: boolean };

/**
 * Fold an answer to a comparable form: unify smart quotes, collapse whitespace,
 * drop trailing sentence punctuation, and (unless caseSensitive) lowercase.
 * DESIGN_DOC §5.3.
 */
export function normalizeAnswer(
  value: string,
  { caseSensitive = false }: NormalizeOptions = {}
): string {
  let out = value
    .replace(SMART_QUOTES, "'")
    .replace(SMART_DQUOTES, '"')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(TRAILING_PUNCT, '')
    .trimEnd();
  if (!caseSensitive) out = out.toLowerCase();
  return out;
}

/** True if `value` matches any accepted answer after normalization. */
export function checkAnswer(
  value: string,
  answers: string[],
  options: NormalizeOptions = {}
): boolean {
  const normalized = normalizeAnswer(value, options);
  if (normalized === '') return false;
  return answers.some((a) => normalizeAnswer(a, options) === normalized);
}
