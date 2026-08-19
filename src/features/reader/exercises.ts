import type { Exercise } from '@/content/schema';
import { toSentences } from './parse/text';
import { estimateCoverage, stems, type FreqIndex } from './difficulty';

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const wholeWord = (w: string) => new RegExp(`\\b${escapeRe(w)}\\b`, 'i');

/**
 * Build vocabulary exercises straight from a chapter: blank out the learner's own unknown
 * words (frequent enough to be worth learning) in real sentences from the text. Choice when
 * there are enough words for distractors, otherwise gap-fill with a first-letter hint.
 * Deterministic — same chapter yields the same exercises.
 */
export function generateExercises(
  text: string,
  opts: {
    freq: FreqIndex;
    known: Set<string>;
    rankThreshold: number;
    idPrefix: string;
    count?: number;
  }
): Exercise[] {
  const { freq, known, rankThreshold, idPrefix, count = 8 } = opts;
  const { unknown } = estimateCoverage(text, { freq, known, rankThreshold });

  const targets = [...unknown.keys()]
    .filter((w) => w.length >= 3 && /^[a-z]+$/.test(w))
    .map((w) => ({ w, rank: Math.min(...stems(w).map((s) => freq.get(s) ?? Infinity)) }))
    .filter((t) => t.rank !== Infinity && t.rank <= rankThreshold + 3500)
    .sort((a, b) => a.rank - b.rank)
    .map((t) => t.w);

  const sentences = toSentences(text).filter((s) => {
    const n = s.split(/\s+/).length;
    return n >= 6 && n <= 24;
  });
  const sentenceFor = (w: string) => sentences.find((s) => wholeWord(w).test(s));

  const usable = [...new Set(targets.filter((w) => sentenceFor(w)))];
  const exercises: Exercise[] = [];

  usable.slice(0, count).forEach((w, i) => {
    const sentence = sentenceFor(w)!;
    const blanked = sentence.replace(wholeWord(w), '___');
    const id = `${idPrefix}.${i}`;

    if (usable.length >= 4) {
      const pool = usable.filter((x) => x !== w);
      const start = i % pool.length;
      const distractors = [...pool.slice(start), ...pool.slice(0, start)].slice(0, 3);
      const options = [w, ...distractors];
      const rot = i % options.length;
      const rotated = [...options.slice(rot), ...options.slice(0, rot)];
      exercises.push({
        type: 'choice',
        id,
        instruction: {
          en: 'Choose the word that fits the sentence from the text.',
          ru: 'Выбери слово из текста, подходящее в предложение.',
        },
        tags: ['reader.vocab'],
        prompt: blanked,
        options: rotated,
        correctIndex: rotated.indexOf(w),
      });
    } else {
      const hint = w[0] + '_'.repeat(Math.max(1, w.length - 1));
      exercises.push({
        type: 'gap-fill',
        id,
        instruction: { en: `Recall the word (${hint}).`, ru: `Вспомни слово (${hint}).` },
        tags: ['reader.vocab'],
        prompt: blanked,
        answers: [w],
      });
    }
  });

  return exercises;
}
