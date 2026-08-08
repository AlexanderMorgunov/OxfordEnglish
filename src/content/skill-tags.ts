/**
 * Fixed SkillTag vocabulary (DESIGN_DOC §11.3). The skill map (§5.7) is the
 * product's main metric, so tags must come from this registry, not free text.
 * Schema types a tag as `string`; the pack validator enforces membership here.
 * Add a tag here before using it in content.
 */
export const SKILL_TAGS = [
  // grammar
  'grammar.past-simple',
  'grammar.past-simple.regular',
  'grammar.past-simple.irregular',
  'grammar.past-simple.negative',
  'grammar.past-simple.question',
  'grammar.present-simple',
  'grammar.present-continuous',
  'grammar.countable-uncountable',
  'grammar.some-any',
  'grammar.would-like',
  'grammar.comparatives',
  'grammar.articles',
  'grammar.word-order',

  // functions (everyday communication)
  'functions.ordering',
  'functions.small-talk',
  'functions.directions',

  // vocabulary (developer-life + everyday themes)
  'vocab.work',
  'vocab.dev',
  'vocab.travel',
  'vocab.daily',
  'vocab.food',
  'vocab.cafe',

  // reading
  'reading.gist',
  'reading.detail',

  // listening
  'listening.gist',
  'listening.detail',
  'listening.dictation',

  // writing / production
  'writing.sentence',
  'writing.translation',
] as const;

export type KnownSkillTag = (typeof SKILL_TAGS)[number];

const REGISTRY = new Set<string>(SKILL_TAGS);

export function isKnownSkillTag(tag: string): tag is KnownSkillTag {
  return REGISTRY.has(tag);
}
