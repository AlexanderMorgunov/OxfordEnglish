export type FreqIndex = Map<string, number>;

/** Rank cutoff below which a word is assumed known at each level (NGSL-style bands). */
const RANK_BY_LEVEL: Record<string, number> = {
  A1: 750,
  A2: 1500,
  B1: 3000,
  B2: 4500,
  C1: 6000,
  C2: 6000,
};
export const rankThresholdFor = (level: string | null | undefined): number =>
  (level && RANK_BY_LEVEL[level]) || 2000;

/**
 * Candidate base forms of a surface token. The frequency list is raw surface forms, so
 * inflected words (walked, cities, running) would otherwise miss; we accept a stem only
 * if it actually appears in the list, which keeps over-stemming harmless.
 */
/** Common irregular forms the suffix rules cannot reach (surface → dictionary form). */
const IRREGULAR: Record<string, string> = {
  was: 'be', were: 'be', been: 'be', am: 'be', is: 'be', are: 'be',
  had: 'have', has: 'have', did: 'do', does: 'do', done: 'do',
  went: 'go', gone: 'go', made: 'make', said: 'say', got: 'get', gotten: 'get',
  came: 'come', took: 'take', taken: 'take', saw: 'see', seen: 'see',
  knew: 'know', known: 'know', gave: 'give', given: 'give', found: 'find',
  thought: 'think', told: 'tell', became: 'become', left: 'leave', felt: 'feel',
  brought: 'bring', began: 'begin', begun: 'begin', kept: 'keep', held: 'hold',
  stood: 'stand', understood: 'understand', heard: 'hear', let: 'let', meant: 'mean',
  met: 'meet', paid: 'pay', ran: 'run', run: 'run', sat: 'sit', spoke: 'speak',
  spoken: 'speak', spent: 'spend', lost: 'lose', led: 'lead', built: 'build',
  bought: 'buy', caught: 'catch', taught: 'teach', wrote: 'write', written: 'write',
  drove: 'drive', driven: 'drive', chose: 'choose', chosen: 'choose', ate: 'eat',
  eaten: 'eat', fell: 'fall', fallen: 'fall', flew: 'fly', flown: 'fly',
  grew: 'grow', grown: 'grow', drew: 'draw', threw: 'throw', thrown: 'throw',
  wore: 'wear', worn: 'wear', broke: 'break', broken: 'break',
  sent: 'send', slept: 'sleep', sold: 'sell', won: 'win', put: 'put',
  read: 'read', set: 'set', cut: 'cut', hit: 'hit', cost: 'cost',
  children: 'child', men: 'man', women: 'woman', feet: 'foot', teeth: 'tooth',
  people: 'person', mice: 'mouse', geese: 'goose', better: 'good', best: 'good',
  worse: 'bad', worst: 'bad', more: 'much', most: 'much',
};

/**
 * Only reliable inflectional suffixes are stripped. Derivational ones (-er/-est/-ly) are
 * left alone on purpose: they collide with ordinary words (forest→for, only→on, water→wat),
 * which would over-count coverage. A stem is added only if it is at least 3 letters.
 */
export function stems(raw: string): string[] {
  const w = raw.toLowerCase();
  const out = new Set<string>([w]);
  const add = (s: string) => {
    if (s.length >= 3) out.add(s);
  };
  if (IRREGULAR[w]) out.add(IRREGULAR[w]!); // curated — trust short forms (be, go, do)
  const base = w.replace(/'s$/, '');
  add(base);
  if (base.endsWith('ies')) add(base.slice(0, -3) + 'y'); // cities -> city
  else if (base.endsWith('es')) add(base.slice(0, -2)); // boxes -> box
  else if (base.endsWith('s') && !base.endsWith('ss')) add(base.slice(0, -1)); // cats -> cat
  if (base.endsWith('ied')) add(base.slice(0, -3) + 'y'); // tried -> try
  else if (base.endsWith('ed')) {
    add(base.slice(0, -2)); // walked -> walk
    add(base.slice(0, -1)); // liked -> like
  }
  if (/([bdfglmnprt])\1ed$/.test(base)) add(base.slice(0, -3)); // stopped -> stop
  if (base.endsWith('ing')) {
    add(base.slice(0, -3)); // walking -> walk
    add(base.slice(0, -3) + 'e'); // making -> make
  }
  if (/([bdfglmnprt])\1ing$/.test(base)) add(base.slice(0, -4)); // running -> run
  return [...out];
}

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z']+/g) ?? [];
}

export type Coverage = {
  coverage: number;
  total: number;
  /** Unknown surface words with how often each appears — exercise targeting fodder. */
  unknown: Map<string, number>;
};

/** Share of tokens a learner is likely to know: personal vocab OR frequent enough for level. */
export function estimateCoverage(
  text: string,
  opts: { freq: FreqIndex; known: Set<string>; rankThreshold: number }
): Coverage {
  const { freq, known, rankThreshold } = opts;
  const tokens = tokenize(text);
  const unknown = new Map<string, number>();
  let knownCount = 0;

  for (const tok of tokens) {
    const forms = stems(tok);
    const isKnown = forms.some(
      (s) => known.has(s) || (freq.get(s) ?? Infinity) <= rankThreshold
    );
    if (isKnown) knownCount += 1;
    else unknown.set(tok, (unknown.get(tok) ?? 0) + 1);
  }

  return {
    coverage: tokens.length ? knownCount / tokens.length : 1,
    total: tokens.length,
    unknown,
  };
}

export type WordMark = 'known' | 'learning' | 'new' | 'ignored';

/**
 * Classify a word for in-text status coloring: an explicit personal status wins; otherwise
 * a word frequent enough for the learner's level counts as known, and the rest are "new".
 */
export function classifyWord(
  word: string,
  opts: { status?: string; freq: FreqIndex; rankThreshold: number }
): WordMark {
  const s = opts.status;
  if (s === 'known' || s === 'ignored' || s === 'learning') return s;
  if (s === 'unknown') return 'new';
  const rank = Math.min(...stems(word).map((x) => opts.freq.get(x) ?? Infinity));
  return rank <= opts.rankThreshold ? 'known' : 'new';
}

let freqPromise: Promise<FreqIndex> | null = null;

/** Load the shipped frequency list once; rank = position in the list. */
export function loadFreq(): Promise<FreqIndex> {
  if (!freqPromise) {
    const url = `${import.meta.env.BASE_URL}reader/en-freq.json`;
    freqPromise = fetch(url)
      .then((r) => r.json())
      .then((data: { words: string[] }) => new Map(data.words.map((w, i) => [w, i + 1])))
      .catch(() => new Map<string, number>());
  }
  return freqPromise;
}
