/**
 * Fixed SkillTag vocabulary (DESIGN_DOC §11.3). The skill map (§5.7) is the
 * product's main metric, so tags must come from this registry, not free text.
 * Schema types a tag as `string`; the pack validator enforces membership here.
 * Add a tag here before using it in content.
 */
export const SKILL_TAGS = [
  // grammar
  'grammar.be',
  'grammar.have-got',
  'grammar.pronouns',
  'grammar.possessives',
  'grammar.past-simple',
  'grammar.past-simple.regular',
  'grammar.past-simple.irregular',
  'grammar.past-simple.negative',
  'grammar.past-simple.question',
  'grammar.present-simple',
  'grammar.adverbs-frequency',
  'grammar.prepositions-time',
  'grammar.there-is',
  'grammar.present-continuous',
  'grammar.countable-uncountable',
  'grammar.some-any',
  'grammar.would-like',
  'grammar.comparatives',
  'grammar.articles',
  'grammar.word-order',
  'grammar.present-vs-continuous',
  'grammar.stative-verbs',
  'grammar.modals-ability',
  'grammar.verb-ing-vs-to',
  'grammar.to-purpose',
  'grammar.past-continuous',
  'grammar.past-vs-continuous',
  'grammar.connectors',
  'grammar.adverbs-manner',
  'grammar.prepositions-place',
  'grammar.demonstratives',
  'grammar.adjective-order',
  'grammar.ed-ing-adjectives',
  'grammar.few-little',
  'grammar.one-ones',
  'grammar.imperatives',
  'grammar.prepositions-movement',
  'grammar.both-all',
  'grammar.another-other',

  // functions (everyday communication)
  'functions.ordering',
  'functions.small-talk',
  'functions.directions',
  'functions.requests',
  'functions.offers',
  'functions.apologizing',
  'functions.thanking',
  'functions.describing',

  // vocabulary (developer-life + everyday themes)
  'vocab.work',
  'vocab.dev',
  'vocab.travel',
  'vocab.daily',
  'vocab.food',
  'vocab.cafe',
  'vocab.hobbies',
  'vocab.sport',
  'vocab.feelings',
  'vocab.weather',
  'vocab.transport',
  'vocab.house',
  'vocab.furniture',
  'vocab.appearance',
  'vocab.restaurant',
  'vocab.town',
  'vocab.shops',

  // reading
  'reading.gist',
  'reading.detail',

  // listening & pronunciation
  'listening.gist',
  'listening.detail',
  'listening.dictation',
  'pronunciation',

  // writing / production
  'writing.sentence',
  'writing.translation',
] as const;

export type KnownSkillTag = (typeof SKILL_TAGS)[number];

const REGISTRY = new Set<string>(SKILL_TAGS);

export function isKnownSkillTag(tag: string): tag is KnownSkillTag {
  return REGISTRY.has(tag);
}
