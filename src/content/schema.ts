import { z } from 'zod';
import { isKnownSkillTag } from './skill-tags';

export const LocalizedText = z.object({
  en: z.string().min(1),
  ru: z.string().min(1).optional(),
});

export const LicenseInfo = z.object({
  type: z.enum([
    'CC0',
    'CC-BY',
    'CC-BY-SA',
    'public-domain',
    'original',
    'local-only',
  ]),
  attribution: z.string().optional(),
  sourceUrl: z.string().url().optional(),
});

export const MediaRef = z.object({
  src: z.string().min(1),
  license: LicenseInfo,
  alt: LocalizedText.optional(),
});

export const SkillTag = z
  .string()
  .refine(isKnownSkillTag, (tag) => ({
    message: `Unknown skill tag "${tag}" — add it to SKILL_TAGS (src/content/skill-tags.ts)`,
  }));

export const CommonError = z.object({
  // Trigger substrings; matched against the normalized answer (same folding as
  // checkAnswer), plain contains — no regex (authors write these by hand).
  match: z.array(z.string().min(1)).min(1),
  explanation: LocalizedText,
});

const ExerciseBase = {
  id: z.string().min(1),
  instruction: LocalizedText,
  tags: z.array(SkillTag),
  hint: LocalizedText.optional(),
  explanation: LocalizedText.optional(),
  // Authored typical-mistake bank shown on a matching wrong answer, before AI.
  // Free-input types only (gap-fill/translate/transform/order-words/dictation) —
  // meaningless for choice/spot-error/minimal-pairs (answer visible among options).
  commonErrors: z.array(CommonError).optional(),
};

export const GapFillExercise = z.object({
  ...ExerciseBase,
  type: z.literal('gap-fill'),
  prompt: z.string().min(1),
  cue: z.string().optional(),
  answers: z.array(z.string().min(1)).min(1),
  caseSensitive: z.boolean().optional(),
});

export const ChoiceExercise = z.object({
  ...ExerciseBase,
  type: z.literal('choice'),
  prompt: z.string().min(1),
  options: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
});

export const SpotErrorExercise = z.object({
  ...ExerciseBase,
  type: z.literal('spot-error'),
  variants: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
});

export const MatchExercise = z.object({
  ...ExerciseBase,
  type: z.literal('match'),
  pairs: z.array(z.object({ left: z.string(), right: z.string() })).min(2),
});

export const OrderWordsExercise = z.object({
  ...ExerciseBase,
  type: z.literal('order-words'),
  tokens: z.array(z.string()).min(2),
  correctOrder: z.array(z.number().int().nonnegative()),
});

export const DictationExercise = z.object({
  ...ExerciseBase,
  type: z.literal('dictation'),
  audio: MediaRef,
  answer: z.string().min(1),
});

export const TranslateExercise = z.object({
  ...ExerciseBase,
  type: z.literal('translate'),
  direction: z.enum(['ru-en', 'en-ru']),
  prompt: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1),
});

export const TransformExercise = z.object({
  ...ExerciseBase,
  type: z.literal('transform'),
  prompt: z.string().min(1),
  answers: z.array(z.string().min(1)).min(1),
});

export const MinimalPairsExercise = z.object({
  ...ExerciseBase,
  type: z.literal('minimal-pairs'),
  audio: MediaRef,
  options: z.array(z.string()).min(2),
  correctIndex: z.number().int().nonnegative(),
});

export const Exercise = z.discriminatedUnion('type', [
  GapFillExercise,
  ChoiceExercise,
  SpotErrorExercise,
  MatchExercise,
  OrderWordsExercise,
  DictationExercise,
  TranslateExercise,
  TransformExercise,
  MinimalPairsExercise,
]);

export const GlossaryEntry = z.object({
  word: z.string().min(1),
  ru: z.string().optional(),
  ipa: z.string().optional(),
});

export const ReadingBlock = z.object({
  id: z.string().min(1),
  en: z.string().min(1),
  ru: z.string().optional(),
  audio: MediaRef.optional(),
  // Optional per-block illustration (story episodes use several scenes per reading).
  image: MediaRef.optional(),
});

export const TranscriptCue = z.object({
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  en: z.string().min(1),
  ru: z.string().optional(),
});

export const ReadingSection = z.object({
  type: z.literal('reading'),
  id: z.string().min(1),
  title: LocalizedText,
  image: MediaRef.optional(),
  blocks: z.array(ReadingBlock).min(1),
  glossary: z.array(GlossaryEntry),
  // Credit for sourced (non-original) passage text, e.g. a CC-BY story.
  attribution: z.string().optional(),
});

export const GrammarArticle = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  level: z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']).optional(),
  summary: LocalizedText,
  blocks: z
    .array(
      z.object({
        heading: LocalizedText.optional(),
        text: LocalizedText,
        examples: z
          .array(z.object({ en: z.string().min(1), ru: z.string().optional() }))
          .optional(),
      })
    )
    .min(1),
  pitfalls: z.array(LocalizedText).optional(),
  seeAlso: z.array(z.string()).optional(),
});

export const GrammarReference = z.array(GrammarArticle);

export const GrammarSection = z.object({
  type: z.literal('grammar'),
  id: z.string().min(1),
  title: LocalizedText,
  // Optional link to a reference article (GrammarArticle.id) — "read more".
  ref: z.string().optional(),
  rule: LocalizedText,
  patterns: z
    .array(
      z.object({
        label: LocalizedText,
        formula: z.string().min(1),
        // Optional per-pattern link to a reference article (its sub-topic).
        ref: z.string().optional(),
        examples: z
          .array(
            z.object({
              en: z.string().min(1),
              ru: z.string().optional(),
              highlight: z.tuple([z.number(), z.number()]).optional(),
            })
          )
          .min(1),
      })
    )
    .min(1),
  pitfalls: z.array(LocalizedText).optional(),
});

export const VocabEntry = z.object({
  word: z.string().min(1),
  ru: z.string().min(1),
  ipa: z.string().optional(),
  example: z.string().optional(),
  exampleRu: z.string().optional(),
  audio: MediaRef.optional(),
});

export const VocabularySection = z.object({
  type: z.literal('vocabulary'),
  id: z.string().min(1),
  title: LocalizedText,
  words: z.array(VocabEntry).min(1),
});

export const PracticeSection = z.object({
  type: z.literal('practice'),
  id: z.string().min(1),
  title: LocalizedText,
  exercises: z.array(Exercise).min(1),
});

export const ListeningSection = z.object({
  type: z.literal('listening'),
  id: z.string().min(1),
  title: LocalizedText,
  audio: MediaRef,
  transcript: z.array(TranscriptCue).optional(),
  exercises: z.array(Exercise).min(1),
});

export const Section = z.discriminatedUnion('type', [
  ReadingSection,
  GrammarSection,
  VocabularySection,
  PracticeSection,
  ListeningSection,
]);

export const Level = z.enum(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);

export const Day = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  estimatedMinutes: z.number().int().positive(),
  sections: z.array(Section).min(1),
  tags: z.array(SkillTag),
  // CEFR tier of the day; optional so older content stays valid. Groundwork for
  // level tiers + an entry placement test (serve content matching the user).
  level: Level.optional(),
});

export const Checkpoint = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  drawFromPreviousUnits: z.number().int().nonnegative().optional(),
  questionCount: z.number().int().positive().optional(),
});

/** On-disk unit index (course.json) — days are referenced by id, stored per-file. */
export const UnitIndex = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  // may be empty: units can be declared in the course map before they're authored.
  dayIds: z.array(z.string().min(1)),
  checkpoint: Checkpoint.optional(),
});

export const CourseIndex = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  level: Level,
  license: LicenseInfo,
  units: z.array(UnitIndex).min(1),
});

export const PackManifest = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  version: z.string().min(1),
  level: Level,
  visibility: z.enum(['public', 'local']),
  license: LicenseInfo,
  attributions: z
    .array(
      z.object({
        source: z.string().min(1),
        license: z.string().min(1),
        url: z.string().url().optional(),
      })
    )
    .default([]),
});

export type LocalizedText = z.infer<typeof LocalizedText>;
export type LicenseInfo = z.infer<typeof LicenseInfo>;
export type MediaRef = z.infer<typeof MediaRef>;
export type Level = z.infer<typeof Level>;
export type CommonError = z.infer<typeof CommonError>;
export type Exercise = z.infer<typeof Exercise>;
export type Section = z.infer<typeof Section>;
export type ReadingSection = z.infer<typeof ReadingSection>;
export type GrammarSection = z.infer<typeof GrammarSection>;
export type GrammarArticle = z.infer<typeof GrammarArticle>;
export type VocabEntry = z.infer<typeof VocabEntry>;
export type VocabularySection = z.infer<typeof VocabularySection>;
export type PracticeSection = z.infer<typeof PracticeSection>;
export type ListeningSection = z.infer<typeof ListeningSection>;
export type Day = z.infer<typeof Day>;
export type Checkpoint = z.infer<typeof Checkpoint>;
export type UnitIndex = z.infer<typeof UnitIndex>;
export type CourseIndex = z.infer<typeof CourseIndex>;
export type PackManifest = z.infer<typeof PackManifest>;
