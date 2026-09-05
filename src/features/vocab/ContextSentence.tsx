import { isFormOf, type LemmaData } from './lemma';

/**
 * The source sentence a word/phrase was captured in, with the term emphasised. Words match by their
 * INFLECTED forms (saved "go" bolds "went"/"goes"), not literal string — via `isFormOf`. Phrases match
 * literally (they have no lemma). Tokenises the ORIGINAL string (preserving casing/offsets) rather than
 * lowercasing, and wraps in place, so nothing is lost or duplicated.
 */
export function ContextSentence({
  text,
  term,
  isPhrase,
  data,
  className,
}: {
  text: string;
  term: string;
  isPhrase: boolean;
  data: LemmaData;
  className?: string;
}) {
  return <p className={className}>{isPhrase ? phraseParts(text, term) : wordParts(text, term, data)}</p>;
}

function wordParts(text: string, term: string, data: LemmaData) {
  // Split into alternating non-word / word tokens; only word tokens can match.
  return text.split(/([A-Za-z']+)/).map((tok, i) =>
    i % 2 === 1 && isFormOf(tok, term, data) ? <strong key={i}>{tok}</strong> : tok
  );
}

function phraseParts(text: string, phrase: string) {
  const i = text.toLowerCase().indexOf(phrase.trim().toLowerCase());
  if (i < 0) return text;
  const end = i + phrase.trim().length;
  return [text.slice(0, i), <strong key="p">{text.slice(i, end)}</strong>, text.slice(end)];
}
