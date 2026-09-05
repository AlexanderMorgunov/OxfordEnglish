import { createContext, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover, usePopoverClose } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import {
  canSpeak,
  speakWord,
  speakPassage,
  cancelSpeech,
  listEnglishVoices,
  previewVoice,
  WORD_SPLIT_RE,
  WORD_TEST_RE,
} from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { translateReaderText } from './translate';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { isConfigured, useAiStore } from '@/features/ai/store';
import { wordInContext } from '@/features/ai/functions';
import type { AiConfig } from '@/features/ai/provider';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { classifyWord, estimateCoverage, loadFreq, rankThresholdFor, type FreqIndex, type WordMark } from './difficulty';
import { useReaderSettings, FONT_CLASSES, LEADING_CLASSES } from './settings';
import { runLens, lensKey, type LensArgs, type LensMode } from './lens';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { clampBand } from '@/features/ai/simplify-prompts';
import { track } from '@/features/analytics/analytics';
import type { Level } from '@/content/schema';
import { toSentences } from './parse/text';
import { usePhraseSelect, parsePos, samePos, inPhraseRange, type WordPos } from './phrase-select';
import { useSavedPhrases } from './saved-phrases';
import { phraseMarkedTokens } from './phrase-marks';

/** Reference line for auditioning a read-aloud voice — natural prose so prosody is audible. */
const VOICE_SAMPLE = 'The morning light spilled across the quiet room as she opened the book.';

/** Read-aloud playback-speed presets. */
const RATE_STEPS = [0.75, 1, 1.25, 1.5] as const;

export type Gloss = { ru?: string; ipa?: string };

/** Chapter-level, stable-per-render coloring inputs. Kept in context so a single word's status
 *  change re-renders only that token, not the whole chapter (thousands of WordTokens). */
type ReaderCtx = { freq: FreqIndex | null; rankThreshold: number; coloring: boolean };
const ReaderContext = createContext<ReaderCtx>({ freq: null, rankThreshold: Infinity, coloring: false });

/** The tapped word's meaning IN this sentence (LLM, cached by word+sentence). Rendered inside the
 *  panel so it mounts on open and unmounts on close; the debounce is cancelled on unmount so a quick
 *  tap-and-dismiss (e.g. to hit 🔊/known) never spends a request. First line ("Ещё: …" is a second
 *  line) is reported up for the save-to-vocab path. */
function ContextGloss({
  word,
  sentence,
  config,
  onResolved,
}: {
  word: string;
  sentence: string;
  config: AiConfig;
  onResolved: (firstLine: string) => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void wordInContext(config, word, sentence)
        .then((res) => {
          if (!alive) return;
          setText(res);
          setState('done');
          const first = res.split('\n')[0]?.replace(/^Ещё:\s*/i, '').trim();
          if (first) onResolved(first);
        })
        .catch(() => {
          if (alive) setState('error');
        });
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [word, sentence, config, onResolved]);

  return (
    <div className="mt-2">
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-violet">
        {ru ? 'в контексте' : 'in context'}
      </p>
      {state === 'loading' && <p className="font-mono text-2xs text-faint">…</p>}
      {state === 'error' && (
        <p className="font-mono text-2xs text-faint">{ru ? 'недоступно' : 'unavailable'}</p>
      )}
      {state === 'done' && text && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-content">{text}</p>
      )}
    </div>
  );
}

/** Rendered inside the word popover (book reader only): starts a phrase selection anchored at this
 *  word and dismisses the popover, so the next tapped word sets the phrase end. It's a child of the
 *  panel so usePopoverClose() reads Popover's provider (a hook in WordToken's body would not). */
function SelectPhraseButton({ tokenId }: { tokenId: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const begin = usePhraseSelect((s) => s.begin);
  const close = usePopoverClose();
  return (
    <button
      type="button"
      onClick={() => {
        begin(parsePos(tokenId));
        close();
      }}
      className="font-mono text-2xs text-violet hover:underline"
    >
      {ru ? 'выделить фразу →' : 'select phrase →'}
    </button>
  );
}

/** A tappable word: status underline, pronounce, translate (glossary → AI), save to review.
 *  Memoized + self-classifying: it subscribes only to its own status, so marking one word never
 *  re-renders its neighbours. */
export const WordToken = memo(function WordToken({
  word,
  lookupWord,
  gloss,
  sentence,
  enableContextFetch,
  tokenId,
  phrase,
}: {
  word: string;
  /** The vocabulary identity (status/glossary/save/pronounce), with edge apostrophes stripped so
   *  "'Tis" tracks as "Tis". Defaults to `word`; `word` is what we display. */
  lookupWord?: string;
  gloss?: Gloss;
  sentence: string;
  /** Book reader only: `sentence` is a real sentence, so offer a lazy "in context" translation.
   *  Learn sections pass a whole block here and already have a curated translation, so they omit it. */
  enableContextFetch?: boolean;
  /** `${paraIndex}:${sentenceIndex}:${tokenIndex}` — enables phrase selection (book reader only). */
  tokenId?: string;
  /** This token is inside a saved phrase → underline it as *learning* (gated on the coloring setting,
   *  like word status). Wins over the word's own `new` status on the same token. */
  phrase?: boolean;
}) {
  const lookup = lookupWord ?? word;
  const status = useVocabStore((s) => s.statuses.get(lookup.toLowerCase()));
  const pos = tokenId ? parsePos(tokenId) : null;
  const selected = usePhraseSelect((s) => (pos ? inPhraseRange(pos, s.anchor, s.end) : false));
  const setStatus = useVocabStore((s) => s.setStatus);
  const lang = useUiLang((s) => s.lang);
  const { freq, rankThreshold, coloring } = use(ReaderContext);
  const [fetched, setFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const config = useAiStore((s) => s.config);
  const aiReady = isConfigured(config);
  // The in-context meaning shown (AI); its first line is what we save to the word's vocab card.
  const [wicGloss, setWicGloss] = useState<string | null>(null);

  const openLookup = () => {
    if (gloss?.ru || done) return;
    setDone(true);
    setLoading(true);
    void translateWord(lookup).then((ru) => {
      setFetched(ru);
      setFailed(ru === null);
      setLoading(false);
    });
  };
  const translation = gloss?.ru ?? fetched ?? undefined;
  const classified: WordMark | undefined =
    coloring && freq ? classifyWord(lookup, { status, freq, rankThreshold }) : undefined;
  // Gate the status underline on the coloring setting too — with coloring OFF a saved-"learning" word
  // must not stay underlined (the classify fallback used to leak through when `freq`/classify was null).
  const raw = coloring
    ? classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined)
    : undefined;
  const visible = raw === 'learning' || raw === 'new' ? raw : undefined;
  // A saved-phrase token underlines as learning (also gated on coloring); it wins over `new`.
  const deco: 'learning' | 'new' | undefined = phrase && coloring ? 'learning' : visible;

  return (
    <Popover
      label={word}
      showClose
      trigger={
        <button
          type="button"
          data-widx={tokenId}
          onClick={openLookup}
          className={cn(
            'cursor-pointer rounded-[2px]',
            deco ? 'underline decoration-2 underline-offset-4' : 'hover:bg-surface-2',
            deco === 'learning' && '[text-decoration-color:var(--color-word-learning)]',
            deco === 'new' && '[text-decoration-color:var(--color-word-unknown)]',
            selected && 'bg-violet-dim text-content'
          )}
        >
          {word}
        </button>
      }
    >
      <div className="flex items-center gap-2">
        <p className="font-mono text-sm text-content">{word}</p>
        {canSpeak() && (
          <button
            type="button"
            aria-label={`Pronounce ${word}`}
            className="text-teal transition-opacity hover:opacity-80"
            onClick={() => speakWord(lookup)}
          >
            🔊
          </button>
        )}
      </div>
      {gloss?.ipa && <p className="font-mono text-xs text-muted">{gloss.ipa}</p>}
      {translation && <p className="mt-1 text-sm text-content">{translation}</p>}
      {loading && <p className="mt-1 font-mono text-2xs text-faint">translating…</p>}
      {failed && !translation && (
        <p className="mt-1 font-mono text-2xs text-faint">
          {lang === 'ru'
            ? 'перевод недоступен — нет сети или дневной лимит словаря'
            : 'unavailable — offline or the free dictionary’s daily limit'}
        </p>
      )}
      {aiReady && enableContextFetch && sentence.includes(' ') && (
        <ContextGloss word={word} sentence={sentence} config={config} onResolved={setWicGloss} />
      )}
      {tokenId && (
        <div className="mt-2">
          <SelectPhraseButton tokenId={tokenId} />
        </div>
      )}
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void setStatus(lookup, 'learning');
            void addWordCard(lookup, translation ?? lookup, sentence, wicGloss ?? undefined);
          }}
        >
          learning
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setStatus(lookup, 'known')}>
          known
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void setStatus(lookup, 'ignored')}
          title={lang === 'ru' ? 'не считать словом (имя, и т. п.)' : 'not a vocabulary word (a name, etc.)'}
        >
          {lang === 'ru' ? 'игнор' : 'ignore'}
        </Button>
      </div>
    </Popover>
  );
});

/** One sentence's shown lens output. `fail` covers offline/no-key/model-failure AND an unverified echo. */
type LensCell =
  | { kind: 'translate'; text: string }
  | { kind: 'simplify'; text: string; stepDown: number }
  | { kind: 'echo' }
  | { kind: 'fail' };

const NO_KNOWN: Set<string> = new Set();

const Paragraph = memo(function Paragraph({
  index,
  text,
  glossary,
  savedPhrases,
  lang,
  active,
  activeSentence,
  onRead,
  onReadSentence,
  lens,
  lensK,
  level,
  onLens,
  bookmarked,
  onToggleBookmark,
  typoClass,
}: {
  index: number;
  text: string;
  glossary?: Map<string, Gloss>;
  /** Saved-phrase keys (`phraseKey`); tokens inside one underline as learning. Stable identity — a
   *  new Set only when a phrase is actually added — so this doesn't re-render the chapter each render. */
  savedPhrases: Set<string>;
  lang: 'en' | 'ru';
  /** A whole-paragraph utterance is in flight for this paragraph — drives the paragraph ▶/❚❚ glyph. */
  active: boolean;
  /** The sentence index currently playing as a one-shot, or null — drives that sentence's ▶/❚❚. */
  activeSentence: number | null;
  onRead: (index: number) => void;
  /** Play a single sentence (paraIndex, sentenceIndex, text). */
  onReadSentence: (index: number, sentenceIndex: number, sentence: string) => void;
  /** Active lens — the per-sentence button runs this ('translate' | 'simplify'). */
  lens: LensMode;
  /** PRIMITIVE key of the active lens config (mode + translate sub-mode + simplify band); a change
   *  re-renders this memoized paragraph and clears its result cells so none go stale. */
  lensK: string;
  level: Level | null;
  /** Run a lens on a sentence (translate / simplify / step-down simplify); null = unavailable. */
  onLens: (mode: LensMode, text: string, stepDown?: number) => Promise<string | null>;
  /** Book reader only: this paragraph is bookmarked, and a per-paragraph bookmark toggle. */
  bookmarked?: boolean;
  onToggleBookmark?: (index: number) => void;
  typoClass: string;
}) {
  const sentences = useMemo(() => toSentences(text), [text]);
  // Per-sentence token indices inside a saved phrase; recomputed only when the text or the saved
  // set changes (not on unrelated re-renders like a sibling word's status flip).
  const phraseMarks = useMemo(
    () => sentences.map((s) => phraseMarkedTokens(s, savedPhrases)),
    [sentences, savedPhrases]
  );
  const { freq } = use(ReaderContext);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [out, setOut] = useState<Record<number, LensCell>>({});
  const [loading, setLoading] = useState<{ idx: number; mode: LensMode } | null>(null);
  // Switching lens / sub-mode / band invalidates every shown cell (a translate result must never linger
  // when the reader flips to simplify), replacing the old `${mode}:${idx}` cache keying.
  useEffect(() => {
    setOut({});
    setOpenIdx(null);
    setLoading(null);
  }, [lensK]);

  const runAt = async (si: number, sentence: string, mode: LensMode, stepDown = 0) => {
    setOpenIdx(si); // one open at a time — keeps the reading unit small
    setLoading({ idx: si, mode });
    if (mode === 'simplify') void track('simplify_used', { band: clampBand(level, stepDown), step: stepDown });
    const res = await onLens(mode, sentence, stepDown);
    let cell: LensCell;
    if (res == null) cell = { kind: 'fail' };
    else if (mode === 'translate') cell = { kind: 'translate', text: res };
    else if (res.trim() === sentence.trim()) {
      // Echo: only call it "already simple" if the sentence genuinely scores at/under the band — else the
      // model likely ignored the instruction on a hard sentence, so offer the RU fallback instead (audit).
      const band = clampBand(level, stepDown);
      const atBand =
        !!freq && estimateCoverage(sentence, { freq, known: NO_KNOWN, rankThreshold: rankThresholdFor(band) }).coverage >= 0.9;
      cell = atBand ? { kind: 'echo' } : { kind: 'fail' };
    } else cell = { kind: 'simplify', text: res, stepDown };
    setOut((o) => ({ ...o, [si]: cell }));
    setLoading(null);
  };

  const ruAction = (si: number, sentence: string) => (
    <button
      type="button"
      onClick={() => void runAt(si, sentence, 'translate', 0)}
      className="ml-1 align-baseline font-mono text-2xs text-teal hover:underline"
    >
      ru →
    </button>
  );

  const renderOut = (si: number, sentence: string) => {
    const r = lang === 'ru';
    if (loading?.idx === si) {
      return (
        <span className="text-base text-muted">
          ({loading.mode === 'simplify' ? (r ? 'упрощаю…' : 'simplifying…') : r ? 'перевод…' : 'translating…'})
        </span>
      );
    }
    const cell = out[si];
    if (!cell || cell.kind === 'fail') {
      return (
        <span className="text-base text-muted">
          ({r ? 'не удалось' : 'unavailable'} {ruAction(si, sentence)})
        </span>
      );
    }
    if (cell.kind === 'translate') return <span className="text-base text-muted">({cell.text}) </span>;
    if (cell.kind === 'echo') {
      return (
        <span className="text-base text-muted">
          ({r ? '✓ уже простое' : '✓ already simple'} {ruAction(si, sentence)})
        </span>
      );
    }
    const canDeeper = clampBand(level, cell.stepDown) !== 'A1';
    return (
      <span className="text-base text-muted">
        <span className="text-teal">≈</span> {cell.text}
        {canDeeper && (
          <button
            type="button"
            onClick={() => void runAt(si, sentence, 'simplify', cell.stepDown + 1)}
            className="ml-1.5 align-baseline font-mono text-2xs text-teal hover:underline"
          >
            {r ? 'ещё проще ↓' : 'simpler ↓'}
          </button>
        )}
        {ruAction(si, sentence)}{' '}
      </span>
    );
  };

  return (
    <p className={typoClass} data-para={index}>
      {canSpeak() && (
        <button
          type="button"
          aria-label={
            active
              ? lang === 'ru'
                ? 'Пауза'
                : 'Pause'
              : lang === 'ru'
                ? 'Читать вслух с этого места'
                : 'Read aloud from here'
          }
          aria-pressed={active}
          className="mr-1.5 align-middle text-teal transition-opacity hover:opacity-80"
          onClick={() => onRead(index)}
        >
          {active ? '❚❚' : '▶'}
        </button>
      )}
      {onToggleBookmark && (
        <button
          type="button"
          aria-label={
            bookmarked
              ? lang === 'ru'
                ? 'Убрать закладку с абзаца'
                : 'Remove bookmark'
              : lang === 'ru'
                ? 'Заложить этот абзац'
                : 'Bookmark this paragraph'
          }
          aria-pressed={bookmarked}
          onClick={() => onToggleBookmark(index)}
          className={cn(
            'mr-1.5 rounded-sm px-0.5 align-middle text-sm transition-opacity hover:opacity-100',
            // 🔖 is an emoji (ignores text color), so signal on/off with opacity + an amber tint.
            bookmarked ? 'bg-amber-dim/25 opacity-100' : 'opacity-40'
          )}
        >
          🔖
        </button>
      )}
      {sentences.map((sentence, si) => {
        const open = openIdx === si;
        const sentencePlaying = activeSentence === si;
        // Split on the SAME pattern the phrase selector uses so a token's index means the same array
        // slot; keep each token's ORIGINAL index `i` as its key/tokenId (`phraseFromRange` re-derives it).
        const toks = sentence.split(WORD_SPLIT_RE);
        const firstWordAt = toks.findIndex((t) => WORD_TEST_RE.test(t));
        const marks = phraseMarks[si]!;
        const renderTok = (tok: string, i: number) => {
          if (!WORD_TEST_RE.test(tok)) return <span key={i}>{tok}</span>;
          const key = tok.replace(/^'+|'+$/g, '');
          if (!key) return <span key={i}>{tok}</span>;
          return (
            <WordToken
              key={i}
              word={tok}
              lookupWord={key}
              gloss={glossary?.get(key.toLowerCase())}
              sentence={sentence}
              enableContextFetch
              tokenId={`${index}:${si}:${i}`}
              phrase={marks.has(i)}
            />
          );
        };
        const playButton = canSpeak() ? (
          <button
            key="play"
            type="button"
            aria-label={
              sentencePlaying
                ? lang === 'ru'
                  ? 'Остановить предложение'
                  : 'Stop sentence'
                : lang === 'ru'
                  ? `Прослушать предложение ${si + 1}`
                  : `Play sentence ${si + 1}`
            }
            aria-pressed={sentencePlaying}
            onClick={() => onReadSentence(index, si, sentence)}
            className="mr-1 align-baseline font-mono text-[0.78em] text-teal opacity-60 transition-opacity hover:opacity-100"
          >
            {sentencePlaying ? '❚❚' : '▶'}
          </button>
        ) : null;
        return (
          <span key={si}>
            {firstWordAt < 0 ? (
              // No word token (e.g. "123 — 456!"): nothing to orphan; render button + tokens plainly.
              <>
                {playButton}
                {toks.map(renderTok)}
              </>
            ) : (
              // Keep the ▶ glued to its sentence's first word (through any leading dash/number/ellipsis
              // token + its space), so a line-wrap never leaves the button dangling a line above.
              <>
                <span className="whitespace-nowrap">
                  {playButton}
                  {toks.slice(0, firstWordAt + 1).map(renderTok)}
                </span>
                {toks.slice(firstWordAt + 1).map((tok, j) => renderTok(tok, firstWordAt + 1 + j))}
              </>
            )}
            <button
              type="button"
              aria-label={
                open
                  ? lang === 'ru'
                    ? 'Свернуть'
                    : 'Close'
                  : lens === 'simplify'
                    ? lang === 'ru'
                      ? 'упростить предложение'
                      : 'simplify sentence'
                    : lang === 'ru'
                      ? 'перевод предложения'
                      : 'translate sentence'
              }
              aria-pressed={open}
              onClick={() => {
                if (open) setOpenIdx(null);
                else void runAt(si, sentence, lens, 0);
              }}
              className="ml-0.5 align-super font-mono text-2xs text-teal hover:underline"
            >
              {open ? '×' : lens === 'simplify' ? 'en↓' : 'ru'}
            </button>{' '}
            {open && renderOut(si, sentence)}
          </span>
        );
      })}
    </p>
  );
});

/** Render paragraphs of reading text with word lookup and per-paragraph read-aloud. */
export function ReadingText({
  paragraphs,
  glossary,
  bookmarkedParas,
  onToggleBookmark,
}: {
  paragraphs: string[];
  glossary?: Map<string, Gloss>;
  /** Book reader only: paragraph indices bookmarked on this page, and a per-paragraph toggle. */
  bookmarkedParas?: Set<number>;
  onToggleBookmark?: (paraIndex: number) => void;
}) {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const level = useLearner((s) => s.level);
  const loadVocab = useVocabStore((s) => s.load);
  const coloring = useReaderSettings((s) => s.coloring);
  const toggleColoring = useReaderSettings((s) => s.toggleColoring);
  const fontStep = useReaderSettings((s) => s.fontStep);
  const lineStep = useReaderSettings((s) => s.lineStep);
  const setFontStep = useReaderSettings((s) => s.setFontStep);
  const setLineStep = useReaderSettings((s) => s.setLineStep);
  const voiceURI = useReaderSettings((s) => s.voiceURI);
  const setVoiceURI = useReaderSettings((s) => s.setVoiceURI);
  const rate = useReaderSettings((s) => s.rate);
  const setRate = useReaderSettings((s) => s.setRate);
  const aiTranslation = useReaderSettings((s) => s.aiTranslation);
  const toggleAiTranslation = useReaderSettings((s) => s.toggleAiTranslation);
  const lens = useReaderSettings((s) => s.lens);
  const setLens = useReaderSettings((s) => s.setLens);
  const aiConfig = useAiStore((s) => s.config);
  const aiConfigured = isConfigured(aiConfig);
  // Simplify needs a BYOK key; with AI off, fall back to the translate lens so the button always works.
  const effLens: LensMode = lens === 'simplify' && aiConfigured ? 'simplify' : 'translate';
  // Stable lens callback (reads live mode/config/level via a ref) so the memoized Paragraph gets a constant
  // `onLens` and only re-renders when the primitive `lensK` changes. `translateArgs` still serves the phrase
  // path below.
  const translateArgs = useRef({ ai: aiTranslation, config: aiConfig });
  translateArgs.current = { ai: aiTranslation, config: aiConfig };
  const lensArgs = useRef<LensArgs>({ ai: aiTranslation, config: aiConfig, level });
  lensArgs.current = { ai: aiTranslation, config: aiConfig, level };
  const onLens = useCallback(
    (mode: LensMode, text: string, stepDown?: number) => runLens(mode, text, lensArgs.current, stepDown),
    []
  );
  const lensK = lensKey(effLens, { ai: aiTranslation, config: aiConfig, level });
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listEnglishVoices());
  useEffect(() => {
    const sync = () => setVoices(listEnglishVoices());
    sync();
    window.speechSynthesis?.addEventListener?.('voiceschanged', sync);
    return () => window.speechSynthesis?.removeEventListener?.('voiceschanged', sync);
  }, []);
  const chooseVoice = (uri: string | null) => {
    setVoiceURI(uri);
    previewVoice(uri, VOICE_SAMPLE);
  };
  const typoClass = `${FONT_CLASSES[fontStep] ?? FONT_CLASSES[1]} ${LEADING_CLASSES[lineStep] ?? LEADING_CLASSES[0]}`;
  const [freq, setFreq] = useState<FreqIndex | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  // `speakingActive` = an utterance is in flight (drives the ❚❚ glyph); `playingRef` = a read
  // session is engaged, whether actively speaking or paused mid-paragraph. `resumeChunkRef` is the
  // chunk (sentence) to resume from inside `speakingIdx` — so a pause continues where it stopped
  // instead of restarting the paragraph, and sentence-mode advances one sentence per play.
  const [speakingActive, setSpeakingActive] = useState(false);
  // Non-null while a single sentence (not the whole paragraph) is playing — its index within
  // `speakingIdx`. Keeps the per-sentence ▶ and the paragraph ▶ as separate, unambiguous controls.
  const [speakingSentence, setSpeakingSentence] = useState<number | null>(null);
  const playingRef = useRef(false);
  const activeRef = useRef(false);
  const resumeChunkRef = useRef(0);
  // Read live in speakFrom's continuation chain (whose onEnd closure is frozen at play time),
  // so mid-read changes to speed/highlight take effect from the next paragraph or sentence.
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );

  const textRef = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseRu, setPhraseRu] = useState<string | null>(null);
  const [phraseSentence, setPhraseSentence] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseSaved, setPhraseSaved] = useState(false);
  const pickAnchor = usePhraseSelect((s) => s.anchor);
  const clearPick = usePhraseSelect((s) => s.clear);
  const savedPhrases = useSavedPhrases((s) => s.phrases);

  useEffect(() => {
    void loadVocab();
    void loadFreq().then(setFreq);
    void useSavedPhrases.getState().load();
    usePhraseSelect.getState().clear();
    return () => usePhraseSelect.getState().clear();
  }, [loadVocab]);
  useEffect(
    () => () => {
      playingRef.current = false;
      cancelSpeech();
    },
    []
  );

  const setPhraseText = (text: string, sentence?: string) => {
    setPhrase(text);
    setPhraseSentence(sentence ?? null);
    setPhraseRu(null);
    // Already in the word bank → show it as saved instead of offering "+ save" again.
    setPhraseSaved(useSavedPhrases.getState().has(text));
    setPhraseLoading(true);
    // Pass the phrase's sentence so the AI translates it IN context ("fowling pieces" → "охотничьи
    // ружья", not a literal "кусочки"); the free path ignores the context.
    void translateReaderText(text, { ...translateArgs.current, sentence }).then((tr) => {
      setPhraseRu(tr);
      setPhraseLoading(false);
    });
  };

  // A multi-word selection becomes a savable phrase ("took a train"); single-word taps stay on the
  // WordToken popover. On touch, native selection is disabled (select-none, coarse pointers) and the
  // phrase is built by tapping — see onPickTap. On a mouse, drag-select still works.
  const tokenPosAt = (node: Node | null): WordPos | null => {
    const start = node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
    const el = start?.closest('[data-widx]') as HTMLElement | null;
    return el?.dataset.widx ? parsePos(el.dataset.widx) : null;
  };

  const onSelect = () => {
    const sel = window.getSelection();
    const inside = sel?.anchorNode ? (textRef.current?.contains(sel.anchorNode) ?? false) : false;
    if (!sel || !inside) {
      if (!pickAnchor) setPhrase(null);
      return;
    }
    // Prefer deriving the phrase from the two endpoint word tokens: this keeps button glyphs (▶, ru)
    // out of the saved text (a drag past the sentence end would otherwise capture them) and carries
    // the sentence as context for the AI translator. Fall back to the raw selection only when an
    // endpoint isn't a word token.
    const a = tokenPosAt(sel.anchorNode);
    const b = tokenPosAt(sel.focusNode);
    if (a && b && a.p === b.p && a.s === b.s && a.t !== b.t) {
      const sentence = toSentences(paragraphs[a.p] ?? '')[a.s] ?? '';
      setPhraseText(phraseFromRange(a, b, sentence), sentence);
      return;
    }
    const text = sel.toString().trim().replace(/\s+/g, ' ');
    if (text.includes(' ') && text.length <= 80) setPhraseText(text);
    else if (!pickAnchor) setPhrase(null);
  };

  const phraseFromRange = (a: WordPos, b: WordPos, sentence: string): string => {
    // Same split as the render (WORD_SPLIT_RE) so a token's `.t` index means the same array slot.
    const parts = sentence.split(WORD_SPLIT_RE);
    return parts
      .slice(Math.min(a.t, b.t), Math.max(a.t, b.t) + 1)
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
  };

  // Tap-to-select on touch: "select phrase" set the anchor; each tap in the same sentence sets the
  // end. Runs on capture so it pre-empts the word's own popover open (Popover appends its toggle to
  // the trigger's onClick, so stopping it here is the only way to suppress both).
  const onPickTap = (e: React.MouseEvent) => {
    const st = usePhraseSelect.getState();
    if (!st.anchor) return;
    const el = (e.target as HTMLElement).closest('[data-widx]') as HTMLElement | null;
    if (!el?.dataset.widx) return;
    e.stopPropagation();
    const pos = parsePos(el.dataset.widx);
    if (samePos(pos, st.anchor)) return cancelPick();
    if (pos.p !== st.anchor.p || pos.s !== st.anchor.s) return; // stay within one sentence
    st.extend(pos);
    const sentence = toSentences(paragraphs[st.anchor.p] ?? '')[st.anchor.s] ?? '';
    setPhraseText(phraseFromRange(st.anchor, pos, sentence), sentence);
  };

  const cancelPick = () => {
    clearPick();
    setPhrase(null);
  };

  const savePhrase = () => {
    if (!phrase) return;
    setPhraseSaved(true);
    clearPick();
    useSavedPhrases.getState().add(phrase);
    void addPhraseCard(phrase, phraseRu ?? phrase, phraseSentence ?? undefined);
  };

  const rankThreshold = rankThresholdFor(level);
  const readerCtx = useMemo<ReaderCtx>(
    () => ({ freq, rankThreshold, coloring }),
    [freq, rankThreshold, coloring]
  );

  // Continuous read-aloud: after each paragraph ends, advance to the next and scroll it into
  // view. Reading-while-listening works only when playback flows across paragraphs, not stops.
  // 'nearest', not 'center': a large paragraph (common in PDFs) must not jump the reader to its
  // middle. Only scrolls when the paragraph start isn't already in view — e.g. auto-advancing to the
  // next one — so clicking play on a visible paragraph doesn't move the page.
  const scrollToPara = (i: number) => {
    const el = textRef.current?.querySelector(`[data-para="${i}"]`);
    el?.scrollIntoView({ block: 'nearest', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const speakFrom = (i: number, startChunk: number) => {
    if (i < 0 || i >= paragraphs.length) {
      stopReading();
      return;
    }
    setSpeakingIdx(i);
    activeRef.current = true;
    setSpeakingActive(true);
    scrollToPara(i);
    const spoken = toSentences(paragraphs[i]!).join(' ');
    speakPassage(spoken, {
      rate: rateRef.current,
      startChunk,
      // Remember the resume point as each chunk actually starts (from `onstart`, not enqueue).
      onChunk: (chunkIdx) => {
        resumeChunkRef.current = chunkIdx;
      },
      onEnd: () => {
        if (!playingRef.current) return;
        resumeChunkRef.current = 0;
        speakFrom(i + 1, 0);
      },
    });
  };

  const stopReading = () => {
    playingRef.current = false;
    activeRef.current = false;
    resumeChunkRef.current = 0;
    cancelSpeech();
    setSpeakingActive(false);
    setSpeakingSentence(null);
    setSpeakingIdx(-1);
  };

  const read = (idx: number) => {
    // Only the paragraph (continuous) session pauses/resumes; a one-shot sentence play does not.
    if (speakingSentence === null) {
      // Actively speaking this paragraph → pause, remembering the current sentence.
      if (activeRef.current && speakingIdx === idx) {
        activeRef.current = false;
        setSpeakingActive(false);
        cancelSpeech();
        return;
      }
      // Paused on this paragraph → resume from where it stopped.
      if (playingRef.current && speakingIdx === idx) {
        playingRef.current = true;
        speakFrom(idx, resumeChunkRef.current);
        return;
      }
    }
    // Fresh start (a different paragraph, nothing playing, or cancelling a sentence play).
    cancelSpeech();
    setSpeakingSentence(null);
    resumeChunkRef.current = 0;
    playingRef.current = true;
    speakFrom(idx, 0);
  };
  // Stable identity so a memoized Paragraph isn't re-rendered by a fresh onRead closure each render.
  const readRef = useRef(read);
  readRef.current = read;
  const onRead = useCallback((i: number) => readRef.current(i), []);

  // Play exactly one sentence, on demand and replayable. Speaks the sentence text standalone; clicking
  // the sentence that's already playing stops it.
  const readSentence = (paraIdx: number, sIdx: number, sentence: string) => {
    const wasThis = speakingIdx === paraIdx && speakingSentence === sIdx;
    stopReading();
    if (wasThis) return;
    playingRef.current = true;
    activeRef.current = true;
    setSpeakingActive(true);
    setSpeakingIdx(paraIdx);
    setSpeakingSentence(sIdx);
    speakPassage(sentence, {
      rate: rateRef.current,
      onEnd: () => stopReading(),
    });
  };
  const readSentenceRef = useRef(readSentence);
  readSentenceRef.current = readSentence;
  const onReadSentence = useCallback(
    (p: number, s: number, t: string) => readSentenceRef.current(p, s, t),
    []
  );

  // Stable identity so a memoized Paragraph isn't re-rendered by a fresh callback each render.
  const toggleBookmarkRef = useRef(onToggleBookmark);
  toggleBookmarkRef.current = onToggleBookmark;
  const onToggleBm = useCallback((i: number) => toggleBookmarkRef.current?.(i), []);

  // Leaving the tab/app stops read-aloud and drops the resume position — the browser cancels speech
  // on hide anyway, and without this the React state would stay stuck on "speaking".
  const stopRef = useRef(stopReading);
  stopRef.current = stopReading;
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stopRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  // A chapter change swaps `paragraphs` without remounting this component, so reset playback —
  // otherwise a resume/highlight position from the old chapter is applied to the new one.
  useEffect(() => {
    stopRef.current();
  }, [paragraphs]);

  return (
    <div className="flex flex-col gap-4">
      <details>
        <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline [&::-webkit-details-marker]:hidden">
          ⚙ {ru ? 'настройки чтения' : 'reader settings'}
        </summary>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5" role="group" aria-label={ru ? 'Размер текста' : 'Text size'}>
          <button
            type="button"
            aria-label={ru ? 'Меньше' : 'Smaller'}
            disabled={fontStep === 0}
            onClick={() => setFontStep(fontStep - 1)}
            className="font-mono text-2xs text-teal hover:underline disabled:text-faint disabled:no-underline"
          >
            A−
          </button>
          <button
            type="button"
            aria-label={ru ? 'Больше' : 'Larger'}
            disabled={fontStep === FONT_CLASSES.length - 1}
            onClick={() => setFontStep(fontStep + 1)}
            className="font-mono text-2xs text-teal hover:underline disabled:text-faint disabled:no-underline"
          >
            A+
          </button>
          <button
            type="button"
            aria-label={ru ? 'Межстрочный интервал' : 'Line spacing'}
            aria-pressed={lineStep === 1}
            onClick={() => setLineStep(lineStep === 1 ? 0 : 1)}
            className="font-mono text-2xs text-teal hover:underline"
          >
            ↕
          </button>
        </div>
        <button
          type="button"
          onClick={toggleColoring}
          aria-pressed={coloring}
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {coloring
            ? ru
              ? 'подсветка слов: вкл'
              : 'word coloring: on'
            : ru
              ? 'подсветка слов: выкл'
              : 'word coloring: off'}
        </button>
        {coloring && (
          <span className="font-mono text-2xs text-muted">
            <span className="underline decoration-2 underline-offset-2 [text-decoration-color:var(--color-word-learning)]">
              {ru ? 'изучаю' : 'learning'}
            </span>
            {' · '}
            <span className="underline decoration-2 underline-offset-2 [text-decoration-color:var(--color-word-unknown)]">
              {ru ? 'новое' : 'new'}
            </span>
          </span>
        )}
        {canSpeak() && voices.length > 0 && (
          <div className="flex items-center gap-1.5" role="group" aria-label={ru ? 'Голос озвучки' : 'Read-aloud voice'}>
            <label htmlFor="reader-voice" className="sr-only">
              {ru ? 'Голос озвучки' : 'Read-aloud voice'}
            </label>
            <select
              id="reader-voice"
              value={voiceURI ?? ''}
              onChange={(e) => chooseVoice(e.target.value || null)}
              className="max-w-[11rem] truncate rounded-sm border border-line bg-surface px-1.5 py-0.5 font-mono text-2xs text-muted"
            >
              <option value="">{ru ? '🔊 голос: авто' : '🔊 voice: auto'}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              aria-label={ru ? 'Прослушать голос' : 'Preview voice'}
              onClick={() => previewVoice(voiceURI, VOICE_SAMPLE)}
              className="font-mono text-2xs text-teal hover:underline"
            >
              ▶
            </button>
          </div>
        )}
        {canSpeak() && (
          <div className="flex items-center gap-1.5" role="group" aria-label={ru ? 'Скорость озвучки' : 'Read-aloud speed'}>
            <span className="font-mono text-2xs text-muted">{ru ? 'скорость' : 'speed'}</span>
            {RATE_STEPS.map((r) => (
              <button
                key={r}
                type="button"
                aria-pressed={rate === r}
                onClick={() => setRate(r)}
                className={cn('font-mono text-2xs hover:underline', rate === r ? 'text-teal' : 'text-muted')}
              >
                {r}×
              </button>
            ))}
          </div>
        )}
        <button
          type="button"
          onClick={toggleAiTranslation}
          disabled={!aiConfigured}
          aria-pressed={aiTranslation && aiConfigured}
          title={
            aiConfigured
              ? ru
                ? 'Переводить предложения и фразы через ИИ (текст уходит вашему AI-провайдеру)'
                : 'Translate sentences and phrases with the AI (text is sent to your AI provider)'
              : ru
                ? 'Сначала включите ИИ в настройках'
                : 'Enable AI in settings first'
          }
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
        >
          {aiTranslation && aiConfigured
            ? ru
              ? 'перевод: ИИ'
              : 'translate: AI'
            : ru
              ? 'перевод: бесплатный'
              : 'translate: free'}
        </button>
        <button
          type="button"
          onClick={() => setLens(lens === 'simplify' ? 'translate' : 'simplify')}
          disabled={!aiConfigured}
          aria-pressed={effLens === 'simplify'}
          title={
            aiConfigured
              ? ru
                ? 'Линза по тапу на предложение: перевод на русский или упрощение на английском под ваш уровень (текст уходит вашему AI-провайдеру)'
                : 'Per-sentence lens: translate to Russian, or simplify in English at your level (text is sent to your AI provider)'
              : ru
                ? 'Упрощение требует ИИ — включите его в настройках'
                : 'Simplify needs AI — enable it in settings'
          }
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
        >
          {effLens === 'simplify' ? (ru ? 'линза: упрощение' : 'lens: simplify') : ru ? 'линза: перевод' : 'lens: translate'}
        </button>
        </div>
        {!aiConfigured && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs text-muted">
            <span>
              {ru
                ? 'AI-перевод и упрощение предложений требуют ключ ИИ (перевод слов и озвучка работают и без него).'
                : 'AI translation and sentence simplification need an AI key (word lookup and read-aloud work without one).'}
            </span>
            <AiUpsellLink />
          </p>
        )}
      </details>
      {pickAnchor && (
        <div className="sticky top-2 z-10 mb-2 flex items-center gap-3 rounded-sm border border-violet-dim bg-violet-dim/15 px-3 py-2 text-sm">
          <span className="text-content">
            {ru ? 'Тапните последнее слово фразы' : 'Tap the last word of the phrase'}
          </span>
          <button
            type="button"
            onClick={cancelPick}
            className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-violet hover:underline"
          >
            {ru ? 'отмена' : 'cancel'}
          </button>
        </div>
      )}
      {phrase && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-sm border border-teal-dim bg-surface-2 px-3 py-2 text-sm shadow-md">
          <span className="font-mono text-teal">{phrase}</span>
          {canSpeak() && (
            <button
              type="button"
              aria-label={ru ? `Произнести ${phrase}` : `Pronounce ${phrase}`}
              className="text-teal transition-opacity hover:opacity-80"
              onClick={() => speakWord(phrase)}
            >
              🔊
            </button>
          )}
          <span className="text-muted">
            {phraseLoading
              ? ru
                ? 'перевод…'
                : 'translating…'
              : phraseRu
                ? `— ${phraseRu}`
                : ru
                  ? '— перевод недоступен'
                  : '— translation unavailable'}
          </span>
          <button
            type="button"
            disabled={phraseSaved}
            className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
            onClick={savePhrase}
          >
            {phraseSaved ? (ru ? '✓ сохранено' : '✓ saved') : ru ? '+ в словарь' : '+ save'}
          </button>
          <button
            type="button"
            aria-label={ru ? 'Закрыть' : 'Dismiss'}
            className="font-mono text-2xs text-muted hover:text-content"
            onClick={cancelPick}
          >
            ×
          </button>
        </div>
      )}
      <ReaderContext.Provider value={readerCtx}>
        <div
          ref={textRef}
          className="flex flex-col gap-4 [@media(pointer:coarse)]:select-none [@media(pointer:coarse)]:[-webkit-touch-callout:none]"
          onMouseUp={onSelect}
          onTouchEnd={onSelect}
          onClickCapture={onPickTap}
        >
          {paragraphs.map((p, i) => (
            <Paragraph
              key={i}
              index={i}
              text={p}
              glossary={glossary}
              savedPhrases={savedPhrases}
              lang={lang}
              // The paragraph ▶/❚❚ reflects only continuous (whole-paragraph) playback, never a
              // one-shot sentence play — those are separate controls.
              active={speakingActive && speakingIdx === i && speakingSentence === null}
              activeSentence={
                speakingActive && speakingIdx === i && speakingSentence !== null ? speakingSentence : null
              }
              onRead={onRead}
              onReadSentence={onReadSentence}
              lens={effLens}
              lensK={lensK}
              level={level}
              onLens={onLens}
              bookmarked={bookmarkedParas?.has(i) ?? false}
              onToggleBookmark={onToggleBookmark ? onToggleBm : undefined}
              typoClass={typoClass}
            />
          ))}
        </div>
      </ReaderContext.Provider>
    </div>
  );
}
