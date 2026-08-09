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

const ExerciseBase = {
  id: z.string().min(1),
  instruction: LocalizedText,
  tags: z.array(SkillTag),
  hint: LocalizedText.optional(),
  explanation: LocalizedText.optional(),
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

export const Exercise = z.discriminatedUnion('type', [
  GapFillExercise,
  ChoiceExercise,
  SpotErrorExercise,
  MatchExercise,
  OrderWordsExercise,
  DictationExercise,
  TranslateExercise,
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

export const GrammarSection = z.object({
  type: z.literal('grammar'),
  id: z.string().min(1),
  title: LocalizedText,
  rule: LocalizedText,
  patterns: z
    .array(
      z.object({
        label: LocalizedText,
        formula: z.string().min(1),
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
  PracticeSection,
  ListeningSection,
]);

export const Day = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  estimatedMinutes: z.number().int().positive(),
  sections: z.array(Section).min(1),
  tags: z.array(SkillTag),
});

export const Checkpoint = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  drawFromPreviousUnits: z.number().int().nonnegative().optional(),
  questionCount: z.number().int().positive().optional(),
});

const LEVEL = z.enum(['A1', 'A2', 'B1', 'B2']);

/** On-disk unit index (course.json) — days are referenced by id, stored per-file. */
export const UnitIndex = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  dayIds: z.array(z.string().min(1)).min(1),
  checkpoint: Checkpoint.optional(),
});

export const CourseIndex = z.object({
  id: z.string().min(1),
  title: LocalizedText,
  level: LEVEL,
  license: LicenseInfo,
  units: z.array(UnitIndex).min(1),
});

export const PackManifest = z.object({
  id: z.string().min(1),
  name: LocalizedText,
  version: z.string().min(1),
  level: LEVEL,
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
export type Exercise = z.infer<typeof Exercise>;
export type Section = z.infer<typeof Section>;
export type ReadingSection = z.infer<typeof ReadingSection>;
export type GrammarSection = z.infer<typeof GrammarSection>;
export type PracticeSection = z.infer<typeof PracticeSection>;
export type ListeningSection = z.infer<typeof ListeningSection>;
export type Day = z.infer<typeof Day>;
export type Checkpoint = z.infer<typeof Checkpoint>;
export type UnitIndex = z.infer<typeof UnitIndex>;
export type CourseIndex = z.infer<typeof CourseIndex>;
export type PackManifest = z.infer<typeof PackManifest>;
