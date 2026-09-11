import { stems } from '@/features/reader/difficulty';
import { baseForm, type LemmaData } from './lemma';

/**
 * Hand-curated irregular forms ("go — went — gone") for the vocabulary row and the reader popover.
 * lemma.en lists forms unordered, so past vs participle can't be derived from it — hence a table.
 * Each line is `base past participle` (verbs) / `base plural` (nouns) / `base comparative superlative`
 * (adjectives); `/` separates variants; `|ru|en` adds a sense label for homographs (lie, hang).
 */
export type Forms = {
  kind: 'verb' | 'noun' | 'adj';
  base: string;
  /** Ordered principal parts, each a list of variants: [[base], [past…], [participle…]]. */
  parts: string[][];
  sense?: { ru: string; en: string };
};

// Omitted on purpose: saw (verb) so "saw" resolves to see; grind/wind, whose forms are common nouns
// (ground, wound) and would mislabel them.
const VERBS = `
arise arose arisen
awake awoke awoken
babysit babysat babysat
be was/were been
bear bore borne/born
beat beat beaten
become became become
begin began begun
bend bent bent
bet bet bet
bind bound bound
bite bit bitten
bleed bled bled
blow blew blown
break broke broken
breed bred bred
bring brought brought
broadcast broadcast broadcast
build built built
burn burned/burnt burned/burnt
burst burst burst
buy bought bought
cast cast cast
catch caught caught
choose chose chosen
cling clung clung
come came come
cost cost cost
creep crept crept
cut cut cut
deal dealt dealt
dig dug dug
dive dived/dove dived
do did done
draw drew drawn
dream dreamed/dreamt dreamed/dreamt
drink drank drunk
drive drove driven
dwell dwelt/dwelled dwelt/dwelled
eat ate eaten
fall fell fallen
feed fed fed
feel felt felt
fight fought fought
find found found
fit fit/fitted fit/fitted
flee fled fled
fling flung flung
fly flew flown
forbid forbade forbidden
forecast forecast forecast
foresee foresaw foreseen
forget forgot forgotten
forgive forgave forgiven
freeze froze frozen
get got got/gotten
give gave given
go went gone
grow grew grown
hang hung hung |вешать|hang up
hang hanged hanged |казнить|execute
have had had
hear heard heard
hide hid hidden
hit hit hit
hold held held
hurt hurt hurt
keep kept kept
kneel knelt/kneeled knelt/kneeled
know knew known
lay laid laid
lead led led
lean leaned/leant leaned/leant
leap leaped/leapt leaped/leapt
learn learned/learnt learned/learnt
leave left left
lend lent lent
let let let
lie lay lain |лежать|lie down
lie lied lied |лгать|tell a lie
light lit/lighted lit/lighted
lose lost lost
make made made
mean meant meant
meet met met
mislead misled misled
mistake mistook mistaken
misunderstand misunderstood misunderstood
mow mowed mown/mowed
overcome overcame overcome
oversleep overslept overslept
overtake overtook overtaken
pay paid paid
prove proved proved/proven
put put put
quit quit quit
read read read
rebuild rebuilt rebuilt
rewrite rewrote rewritten
rid rid rid
ride rode ridden
ring rang rung
rise rose risen
run ran run
say said said
see saw seen
seek sought sought
sell sold sold
send sent sent
set set set
sew sewed sewn/sewed
shake shook shaken
shed shed shed
shine shone/shined shone/shined
shoot shot shot
show showed shown/showed
shrink shrank shrunk
shut shut shut
sing sang sung
sink sank sunk
sit sat sat
sleep slept slept
slide slid slid
smell smelled/smelt smelled/smelt
sneak sneaked/snuck sneaked/snuck
sow sowed sown/sowed
speak spoke spoken
speed sped/speeded sped/speeded
spell spelled/spelt spelled/spelt
spend spent spent
spill spilled/spilt spilled/spilt
spin spun spun
spit spat/spit spat/spit
split split split
spoil spoiled/spoilt spoiled/spoilt
spread spread spread
spring sprang sprung
stand stood stood
steal stole stolen
stick stuck stuck
sting stung stung
stink stank stunk
strike struck struck
swear swore sworn
sweep swept swept
swell swelled swollen/swelled
swim swam swum
swing swung swung
take took taken
teach taught taught
tear tore torn
tell told told
think thought thought
throw threw thrown
undergo underwent undergone
understand understood understood
undertake undertook undertaken
undo undid undone
upset upset upset
wake woke woken
wear wore worn
weave wove woven
weep wept wept
win won won
withdraw withdrew withdrawn
write wrote written
`;

const NOUNS = `
aircraft aircraft
analysis analyses
cactus cacti
calf calves
child children
crisis crises
criterion criteria
deer deer
fish fish
foot feet
goose geese
half halves
knife knives
leaf leaves
life lives
loaf loaves
man men
mouse mice
ox oxen
person people
phenomenon phenomena
sheep sheep
shelf shelves
thief thieves
tooth teeth
wife wives
wolf wolves
woman women
`;

const ADJS = `
bad worse worst
far farther/further farthest/furthest
good better best
ill worse worst
little less least
many more most
much more most
old older/elder oldest/eldest
well better best
`;

// Plurals that are far more often a verb's -s form in running text (she lives, he leaves).
const NO_REVERSE = new Set(['lives', 'leaves']);

function parse(block: string, kind: Forms['kind']): Forms[] {
  return block
    .trim()
    .split('\n')
    .map((line) => {
      const [head = '', ru, en] = line.split('|');
      const parts = head.trim().split(/\s+/).map((p) => p.split('/'));
      const f: Forms = { kind, base: parts[0]![0]!, parts };
      if (ru && en) f.sense = { ru: ru.trim(), en: en.trim() };
      return f;
    });
}

export const IRREGULAR_TABLE: Forms[] = [
  ...parse(VERBS, 'verb'),
  ...parse(NOUNS, 'noun'),
  ...parse(ADJS, 'adj'),
];

const BY_BASE = new Map<string, Forms[]>();
const BY_FORM = new Map<string, Forms[]>();
const push = (m: Map<string, Forms[]>, k: string, f: Forms) => {
  const list = m.get(k);
  if (!list) m.set(k, [f]);
  else if (!list.includes(f)) list.push(f);
};
for (const f of IRREGULAR_TABLE) {
  push(BY_BASE, f.base, f);
  for (const variants of f.parts.slice(1))
    for (const v of variants) if (v !== f.base && !NO_REVERSE.has(v)) push(BY_FORM, v, f);
}

/**
 * The irregular form sets a word belongs to. A word that is itself a base shows its own forms first,
 * then the sets it is a form of ("lay" → lay — laid — laid, then lie — lay — lain). Inflections
 * outside the table ("going", "lying") resolve through the lemma list / suffix rules to their base.
 */
export function irregularForms(word: string, lemma?: LemmaData): Forms[] {
  const w = word.toLowerCase();
  const hits = [...(BY_BASE.get(w) ?? [])];
  for (const f of BY_FORM.get(w) ?? []) if (!hits.includes(f)) hits.push(f);
  if (hits.length) return hits;
  const candidates = [lemma ? baseForm(w, lemma) : null, ...stems(w)];
  for (const c of candidates) {
    const own = c ? BY_BASE.get(c) : undefined;
    if (own) return own;
  }
  return [];
}

export const formsText = (f: Forms) => f.parts.map((p) => p.join('/')).join(' — ');
