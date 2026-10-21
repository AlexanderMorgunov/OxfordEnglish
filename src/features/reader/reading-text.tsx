import { createContext, memo, use, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Popover, PopoverGroup, usePopoverClose } from '@/shared/ui';
import { overflowShift } from './lens-menu';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import {
  speakWord,
  speakPassage,
  cancelSpeech,
  listEnglishVoices,
  subscribeVoices,
  previewVoice,
  WORD_SPLIT_RE,
  WORD_TEST_RE,
} from '@/shared/lib/audio';
import type { Voice } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { translateWord } from '@/features/vocab/translate';
import { translateReaderResult } from './translate';
import type { ReaderTranslation } from './translate';
import {
  addWordCard,
  addPhraseCard,
  repairSavedPhrase,
  repairCardContext,
} from '@/features/srs/service';
import { captureDataScope, subscribeDataScope, getDataScopeRevision } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { captureAiScope, useAiEnabled, useAiUnknown } from '@/features/ai/route';
import { wordInContext } from '@/features/ai/functions';
import type { AiConfig } from '@/features/ai/provider';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { classifyWord, estimateCoverage, loadFreq, rankThresholdFor, type FreqIndex, type WordMark } from './difficulty';
import { useReaderSettings, DEFAULT_FONT_STEP, FONT_CLASSES, LEADING_CLASSES, RATE_STEPS } from './settings';
import { ReaderTextSize } from './ReaderTextSize';
import { keepReadingAnchor } from './reading-anchor';
import { runLens, type LensArgs, type LensMode } from './lens';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { clampBand } from '@/features/ai/simplify-prompts';
import { track } from '@/features/analytics/analytics';
import type { Level } from '@/content/schema';
import { toSentences } from './parse/text';
import { usePhraseSelect, parsePos, samePos, inPhraseRange, type WordPos } from './phrase-select';
import { useSavedPhrases } from './saved-phrases';
import { phraseMarkedTokens } from './phrase-marks';
import { inLensOutput, LENS_OUT_ATTR } from './lens-output';
import { useLemma } from '@/features/vocab/lemma';
import { irregularForms } from '@/features/vocab/irregular';
import { FormsLine } from '@/features/vocab/FormsLine';
import { cefrOf, useCefr } from '@/features/vocab/cefr';
import { CefrChip } from '@/features/vocab/CefrChip';
import { saveReaderTerm, type BookSource } from './chapter-vocabulary';
import type { SrsCard } from '@/db/db';
import { readSavedWord, savedWordMeaning, useSavedWordCards } from './saved-word-meanings';

/** Reference line for auditioning a read-aloud voice — natural prose so prosody is audible. */
const VOICE_SAMPLE = 'The morning light spilled across the quiet room as she opened the book.';

export type Gloss = { ru?: string; ipa?: string };

/** Chapter-level, stable-per-render coloring inputs. Kept in context so a single word's status
 *  change re-renders only that token, not the whole chapter (thousands of WordTokens). */
type ReaderCtx = {
  freq: FreqIndex | null;
  rankThreshold: number;
  coloring: boolean;
  source?: BookSource;
  ownerRevision?: number;
  wordCards?: ReadonlyMap<string, SrsCard>;
};
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
  shouldFinishSaved,
}: {
  word: string;
  sentence: string;
  config: AiConfig | null;
  onResolved: (firstLine: string) => void;
  shouldFinishSaved: () => boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [text, setText] = useState<string | null>(null);
  const [state, setState] = useState<'loading' | 'done' | 'error'>('loading');

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    setText(null);
    setState('loading');
    const current = captureDataScope();
    const timer = setTimeout(() => {
      if (!current()) return;
      void wordInContext(config, word, sentence, controller.signal)
        .then((res) => {
          if (!current() || controller.signal.aborted) return;
          const first = res.split('\n')[0]?.replace(/^Ещё:\s*/i, '')
            .replace(/\*\*/g, '')
            .trim();
          if (first) onResolved(first);
          if (!alive) return;
          setText(res);
          setState('done');
        })
        .catch(() => {
          if (alive) setState('error');
        });
    }, 400);
    return () => {
      alive = false;
      if (!shouldFinishSaved()) controller.abort();
      clearTimeout(timer);
    };
  }, [word, sentence, config, onResolved, shouldFinishSaved]);

  return (
    <div className="mt-2">
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-violet">
        {ru ? 'в контексте' : 'in context'}
      </p>
      {state === 'loading' && (
        <p className="font-mono text-2xs text-faint">…</p>
      )}
      {state === 'error' && (
        <p className="font-mono text-2xs text-faint">{ru ? 'недоступно' : 'unavailable'}</p>
      )}
      {state === 'done' && text && (
        <p className="whitespace-pre-line text-sm leading-relaxed text-content">{text}</p>
      )}
    </div>
  );
}

/** Irregular forms of the tapped word. Lives in the panel so the lemma list loads on first open only. */
function PopoverForms({ word }: { word: string }) {
  const lemma = useLemma();
  const forms = useMemo(() => irregularForms(word, lemma), [word, lemma]);
  return (
    <FormsLine word={word} forms={forms} className="mt-1 font-mono text-2xs" />
  );
}

/** CEFR usefulness chip for the tapped word (lazy CEFR list, loaded on first open). */
function PopoverLevel({ word }: { word: string }) {
  const lemma = useLemma();
  const cefr = useCefr();
  if (!cefr.size) return null;
  return <CefrChip level={cefrOf(word, cefr, lemma)?.level ?? null} />;
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
  const canSpeak = useSpeechAvailable();
  const lookup = lookupWord ?? word;
  const status = useVocabStore((s) => s.statuses.get(lookup.toLowerCase()));
  const pos = tokenId ? parsePos(tokenId) : null;
  const selected = usePhraseSelect((s) =>
    pos ? inPhraseRange(pos, s.anchor, s.end) : false
  );
  const setStatus = useVocabStore((s) => s.setStatus);
  const lang = useUiLang((s) => s.lang);
  const { freq, rankThreshold, coloring, source, wordCards } = use(ReaderContext);
  const savingWord = useRef(false);
  const [wordSave, setWordSave] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [fetched, setFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [savedLookup, setSavedLookup] = useState<{ card: SrsCard; current: () => boolean } | null>(null);
  const lookupEpoch = useRef(0);
  useEffect(() => () => { lookupEpoch.current += 1; }, []);
  useEffect(() => {
    if (!savedLookup && !fetched && !done) return;
    return subscribeDataScope(() => {
      lookupEpoch.current += 1;
      setSavedLookup(null);
      setFetched(null);
      setDone(false);
      setLoading(false);
      setFailed(false);
    });
  }, [savedLookup, fetched, done]);
  const config = useAiStore((s) => s.config);
  const aiReady = useAiEnabled();
  const aiUnknown = useAiUnknown();
  // The in-context meaning shown (AI); its first line is what we save to the word's vocab card.
  const [wicGloss, setWicGloss] = useState<string | null>(null);
  const savedWord = useRef<{
    done: Promise<boolean>;
    current: () => boolean;
    back: string;
  } | null>(null);
  const shouldFinishSaved = useCallback(() => savedWord.current !== null, []);
  const visibleWordSave = savedWord.current && !savedWord.current.current() ? 'idle' : wordSave;
  useEffect(() => {
    if (!savedWord.current) return;
    return subscribeDataScope(() => {
      savedWord.current = null;
      savingWord.current = false;
      setWordSave('idle');
    });
  }, [wordSave]);
  const onGlossResolved = useCallback(
    (meaning: string) => {
      setWicGloss(meaning);
      const save = savedWord.current;
      if (save)
        void save.done
          .then((saved) => {
            if (saved && save.current())
              return repairCardContext(
                `word:${lookup.toLowerCase()}`,
                sentence,
                meaning,
                save.current,
                save.back
              );
          })
          .catch(() => undefined);
    },
    [lookup, sentence]
  );

  const openLookup = () => {
    if (savedWordMeaning(wordCards?.get(lookup.toLowerCase()), sentence) || gloss?.ru || done) return;
    setDone(true);
    setLoading(true);
    const current = captureDataScope();
    const epoch = ++lookupEpoch.current;
    const valid = () => current() && epoch === lookupEpoch.current;
    void (async () => {
      const card = await readSavedWord(lookup);
      if (!valid()) return;
      if (card && savedWordMeaning(card, sentence)) {
        setSavedLookup({ card, current });
        setLoading(false);
        return;
      }
      const result = await translateWord(lookup);
      if (!valid()) return;
      setFetched(result);
      setFailed(result === null);
      setLoading(false);
    })().catch(() => {
      if (valid()) { setFailed(true); setLoading(false); }
    });
  };
  const savedMeaning = savedWordMeaning(wordCards?.get(lookup.toLowerCase()), sentence)
    ?? (wordCards === undefined && savedLookup?.current() ? savedWordMeaning(savedLookup.card, sentence) : undefined);
  const translation = savedMeaning ?? gloss?.ru ?? fetched ?? undefined;
  const classified: WordMark | undefined =
    coloring && freq ? classifyWord(lookup, { status, freq, rankThreshold }) : undefined;
  // Gate the status underline on the coloring setting too — with coloring OFF a saved-"learning" word
  // must not stay underlined (the classify fallback used to leak through when `freq`/classify was null).
  const raw = coloring
    ? (classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined))
    : undefined;
  const visible = raw === 'learning' || raw === 'new' ? raw : undefined;
  // A saved-phrase token underlines as learning (also gated on coloring); it wins over `new`.
  const deco: 'learning' | 'new' | undefined = phrase && coloring ? 'learning' : visible;

  return (
    <Popover
      label={word}
      showClose
      anchorClassName="min-w-0 max-w-full self-baseline"
      className="max-h-[calc(100dvh-1rem)] max-w-[min(16rem,calc(100vw-1rem))] overflow-y-auto [overflow-wrap:anywhere]"
      trigger={
        <button
          type="button"
          data-widx={tokenId}
          lang="en"
          onClick={openLookup}
          className={cn(
            'max-w-full cursor-pointer rounded-[2px] text-left whitespace-normal [overflow-wrap:anywhere]',
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
      <div className="flex flex-wrap items-center gap-2">
        <p lang="en" className="max-w-full font-mono text-sm text-content">{word}</p>
        {canSpeak && (
          <button
            type="button"
            aria-label={`Pronounce ${word}`}
            className="text-teal transition-opacity hover:opacity-80"
            onClick={() => speakWord(lookup)}
          >
            🔊
          </button>
        )}
        <PopoverLevel word={lookup} />
      </div>
      {gloss?.ipa && (
        <p className="font-mono text-xs text-muted">{gloss.ipa}</p>
      )}
      {translation && (
        <p lang="ru" className="mt-1 text-sm text-content">{translation}</p>
      )}
      {savedMeaning && <p className="text-xs text-muted">{lang === 'ru' ? 'Из вашего словаря' : 'From your vocabulary'}</p>}
      <PopoverForms word={lookup} />
      {loading && (
        <p className="mt-1 font-mono text-2xs text-faint">translating…</p>
      )}
      {failed && !translation && (
        <p className="mt-1 font-mono text-2xs text-faint">
          {lang === 'ru'
            ? 'перевод недоступен — нет сети или дневной лимит словаря'
            : 'unavailable — offline or the free dictionary’s daily limit'}
        </p>
      )}
      {(aiReady || aiUnknown) && enableContextFetch && sentence.includes(' ') && (
          <ContextGloss
            word={word}
            sentence={sentence}
            config={config}
            onResolved={onGlossResolved}
            shouldFinishSaved={shouldFinishSaved}
          />
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
          disabled={visibleWordSave === 'saving'}
          onClick={() => {
            if (savingWord.current && savedWord.current?.current()) return;
            const current = captureDataScope();
            savingWord.current = true;
            setWordSave('saving');
            void setStatus(lookup, 'learning');
            const save = {
              done: addWordCard(lookup, translation ?? lookup, sentence, wicGloss ?? undefined),
              current,
              back: translation ?? lookup,
            };
            savedWord.current = save;
            void save.done.then(async (saved) => {
              if (!saved || !current()) return false;
              return source ? saveReaderTerm(source, `word:${lookup.toLowerCase()}`, sentence, current) : true;
            }).then((saved) => {
              if (current()) setWordSave(saved ? 'saved' : 'error');
            }).catch(() => { if (current()) setWordSave('error'); })
              .finally(() => { if (savedWord.current === save) savingWord.current = false; });
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
      {visibleWordSave !== 'idle' && <p role={visibleWordSave === 'error' ? 'alert' : 'status'} className="mt-2 text-xs text-muted">
        {visibleWordSave === 'saving' ? lang === 'ru' ? 'Сохраняю…' : 'Saving…'
          : visibleWordSave === 'saved' ? lang === 'ru' ? '✓ сохранено' : '✓ saved'
          : source ? lang === 'ru' ? 'Не удалось добавить в главу. Нажмите learning ещё раз.' : 'Could not add to chapter. Press learning again.'
          : lang === 'ru' ? 'Не удалось сохранить. Попробуйте ещё раз.' : 'Could not save. Try again.'}
      </p>}
    </Popover>
  );
});

/** One sentence's shown lens output. `fail` covers offline/no-key/model-failure AND an unverified echo. */
type LensCell =
  | { kind: 'translate'; text: string }
  | { kind: 'simplify'; text: string; stepDown: number }
  | { kind: 'grammar'; text: string }
  | { kind: 'echo' }
  | { kind: 'fail' };

const NO_KNOWN: Set<string> = new Set();
const translationSourceLabel = (source: ReaderTranslation['source'], ru: boolean) =>
  source === 'free' ? ru ? 'бесплатный перевод' : 'free translation'
    : source === 'byok' ? ru ? 'свой AI-ключ' : 'your AI key'
      : source === 'managed' ? 'DayEnglish AI' : '';

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
  aiReady,
  aiUnknown,
  lensK,
  level,
  onLens,
  bookmarkedSents,
  onBookmark,
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
  /** AI available (BYOK key set) — gates the simplify/grammar items in the per-sentence lens menu. */
  aiReady: boolean;
  /** Signed in, but the plan is unreadable. Not the same as "no AI": the lock and the paywall link are
   *  claims about the user's plan, and this is the state where we have no basis for either. */
  aiUnknown: boolean;
  /** PRIMITIVE key of the lens config (translate sub-mode + band); a change re-renders this memoized
   *  paragraph and clears its result cells so none go stale. The lens MODE is now chosen per sentence. */
  lensK: string;
  level: Level | null;
  /** Run a lens on a sentence (translate / simplify / grammar / step-down simplify); null = unavailable. */
  onLens: (mode: LensMode, text: string, stepDown?: number, signal?: AbortSignal, onSource?: (source: ReaderTranslation['source']) => void) => Promise<string | null>;
  /** Book reader only: sentence indices in THIS paragraph that are bookmarked (drives the menu
   *  item's заложить/убрать label), and a toggle that anchors a bookmark to a sentence. */
  bookmarkedSents?: Set<number>;
  onBookmark?: (paraIndex: number, sentenceIndex: number, sentence: string) => void;
  typoClass: string;
}) {
  // Hoisted: the sentence play button below reads it from inside `sentences.map`, where a hook
  // cannot go.
  const canSpeak = useSpeechAvailable();
  const sentences = useMemo(() => toSentences(text), [text]);
  // Per-sentence token indices inside a saved phrase; recomputed only when the text or the saved
  // set changes (not on unrelated re-renders like a sibling word's status flip).
  const phraseMarks = useMemo(
    () => sentences.map((s) => phraseMarkedTokens(s, savedPhrases)),
    [sentences, savedPhrases]
  );
  const { freq } = use(ReaderContext);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const pendingLens = useRef<AbortController | null>(null);
  const [out, setOut] = useState<Record<number, LensCell>>({});
  const [sources, setSources] = useState<Record<number, ReaderTranslation['source']>>({});
  const [loading, setLoading] = useState<{
    idx: number;
    mode: LensMode;
  } | null>(null);
  const navigate = useNavigate();
  // Which sentence's lens menu is open (translate / simplify / grammar), or null.
  const [menuIdx, setMenuIdx] = useState<number | null>(null);
  const menuRef = useRef<HTMLSpanElement | null>(null);
  const [menuShift, setMenuShift] = useState(0);

  /**
   * The menu hangs off the ⋯ button, which sits wherever its sentence ends — so near the right margin it
   * opened straight off the screen, with the items unreadable and unreachable.
   *
   * Nudged back by exactly how far it overflows rather than flipped to the other side: flipping moves it
   * away from the button that opened it even when there was room, and a partial overflow only needs a
   * partial correction. Measured from the ANCHOR's position plus the menu's own `offsetWidth`, neither of
   * which the shift changes — measuring the shifted box instead feeds the correction back into itself.
   *
   * The width comes from `documentElement.clientWidth`, NOT `window.innerWidth`. An absolutely positioned
   * box that sticks out extends the document's scrollable area, and `innerWidth` grows with it: on a
   * 360px screen it already read 529 by the time this ran, so the overflow measured as nothing and the
   * menu stayed off the edge. `clientWidth` is the viewport and does not move.
   */
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el?.parentElement) {
      setMenuShift(0);
      return;
    }
    setMenuShift(
      overflowShift(
        el.parentElement.getBoundingClientRect().left,
        el.offsetWidth,
        document.documentElement.clientWidth
      )
    );
  }, [menuIdx]);
  // Changing the translate sub-mode / band invalidates shown cells (a free translation must not linger
  // after switching to AI). The lens MODE is per-sentence now, so it's not part of the key.
  useEffect(() => {
    setOut({});
    setSources({});
    setOpenIdx(null);
    setLoading(null);
    setMenuIdx(null);
    return () => { pendingLens.current?.abort(); pendingLens.current = null; };
  }, [lensK, text]);
  // Close an open menu on an outside click. Ignore the trigger and the menu itself: React 19 flushes
  // the listener-adding effect synchronously, so the very click that opened the menu would otherwise
  // bubble to document and close it again (menu opened-then-closed in one gesture).
  useEffect(() => {
    if (menuIdx === null) return;
    const close = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest('[role="menu"]') || t?.closest('[data-lens-trigger]')) return;
      setMenuIdx(null);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [menuIdx]);

  const runAt = async (si: number, sentence: string, mode: LensMode, stepDown = 0) => {
    pendingLens.current?.abort();
    const controller = new AbortController();
    pendingLens.current = controller;
    const requireActive = captureAiScope(controller.signal);
    setOpenIdx(si); // one open at a time — keeps the reading unit small
    setLoading({ idx: si, mode });
    if (mode === 'simplify') void track('simplify_used', { band: clampBand(level, stepDown), step: stepDown });
    else if (mode === 'grammar') void track('grammar_used', { band: clampBand(level, 0) });
    let res: string | null;
    let answerSource: ReaderTranslation['source'];
    try {
      res = await onLens(mode, sentence, stepDown, controller.signal, source => { answerSource = source; });
      requireActive();
    } catch {
      if (pendingLens.current === controller) {
        pendingLens.current = null;
        setLoading(null);
      }
      return;
    }
    let cell: LensCell;
    if (res == null) cell = { kind: 'fail' };
    else if (mode === 'translate') cell = { kind: 'translate', text: res };
    else if (mode === 'grammar') cell = { kind: 'grammar', text: res };
    else if (res.trim() === sentence.trim()) {
      // Echo: only call it "already simple" if the sentence genuinely scores at/under the band — else the
      // model likely ignored the instruction on a hard sentence, so offer the RU fallback instead (audit).
      const band = clampBand(level, stepDown);
      const atBand =
        !!freq && estimateCoverage(sentence, { freq, known: NO_KNOWN, rankThreshold: rankThresholdFor(band) }).coverage >= 0.9;
      cell = atBand ? { kind: 'echo' } : { kind: 'fail' };
    } else cell = { kind: 'simplify', text: res, stepDown };
    setOut((o) => ({ ...o, [si]: cell }));
    setSources(value => ({ ...value, [si]: answerSource }));
    pendingLens.current = null;
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
      const label =
        loading.mode === 'simplify'
          ? r ? 'упрощаю…' : 'simplifying…'
          : loading.mode === 'grammar'
            ? r ? 'разбираю…' : 'parsing…'
            : r ? 'перевод…' : 'translating…';
      return (
        <span role="status" aria-live="polite" className="text-base text-muted">
          ({label})
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
    if (cell.kind === 'translate')
      return (
        <span role="status" aria-live="polite" className="text-base text-muted">
          ({cell.text}){' '}
        </span>
      );
    if (cell.kind === 'grammar') {
      return (
        <span role="status" aria-live="polite" className="text-base text-muted">
          <span className="text-amber">{r ? 'гр' : 'gr'}</span> {cell.text}{' '}
          {ruAction(si, sentence)}{' '}
        </span>
      );
    }
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
      {canSpeak && (
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
      {sentences.map((sentence, si) => {
        const open = openIdx === si;
        const sentencePlaying = activeSentence === si;
        // Split on the SAME pattern the phrase selector uses so a token's index means the same array
        // slot; keep each token's ORIGINAL index `i` as its key/tokenId (`phraseFromRange` re-derives it).
        const toks = sentence.split(WORD_SPLIT_RE);
        const firstWordAt = toks.findIndex((t) => WORD_TEST_RE.test(t));
        const marks = phraseMarks[si]!;
        const renderTok = (tok: string, i: number) => {
          if (!WORD_TEST_RE.test(tok)) return <span lang="en" key={i}>{tok}</span>;
          const key = tok.replace(/^'+|'+$/g, '');
          if (!key) return <span lang="en" key={i}>{tok}</span>;
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
        const playButton = canSpeak ? (
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
            className="mr-1 shrink-0 align-baseline font-mono text-[0.78em] text-teal opacity-60 transition-opacity hover:opacity-100"
          >
            {sentencePlaying ? '❚❚' : '▶'}
          </button>
        ) : null;
        return (
          <span key={si} data-sent={`${index}:${si}`}>
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
                <span className="inline-flex max-w-full items-start whitespace-break-spaces">
                  {playButton}
                  {toks.slice(0, firstWordAt + 1).map(renderTok)}
                </span>
                {toks.slice(firstWordAt + 1).map((tok, j) => renderTok(tok, firstWordAt + 1 + j))}
              </>
            )}
            <span className="relative mx-1.5 inline-flex align-middle">
              <button
                type="button"
                data-lens-trigger
                aria-haspopup="menu"
                aria-expanded={menuIdx === si}
                aria-label={
                  open
                    ? lang === 'ru'
                      ? 'Свернуть'
                      : 'Close'
                    : lang === 'ru' ? 'линза по предложению' : 'sentence lens'
                }
                onClick={() => {
                  if (open) {
                    pendingLens.current?.abort();
                    pendingLens.current = null;
                    setLoading(null);
                    setOpenIdx(null);
                    setMenuIdx(null);
                  } else setMenuIdx(menuIdx === si ? null : si);
                }}
                className="inline-flex h-7 min-w-[1.9rem] items-center justify-center rounded-md border border-line bg-surface-2/50 px-1.5 font-mono text-sm leading-none text-teal transition-colors hover:bg-surface-2 active:bg-surface-2"
              >
                {open ? '×' : '⋯'}
              </button>
              {menuIdx === si && !open && (
                <span
                  role="menu"
                  ref={menuRef}
                  style={{ marginLeft: menuShift }}
                  className="absolute left-0 top-full z-10 mt-1 flex min-w-[8rem] max-w-[calc(100vw-1rem)] flex-col rounded-sm border border-line bg-surface py-1 shadow-md"
                >
                  {(
                    [
                      ['translate', lang === 'ru' ? 'перевод' : 'translate', 'ru', false],
                      ['simplify', lang === 'ru' ? 'проще' : 'simplify', 'en↓', true],
                      ['grammar', lang === 'ru' ? 'грамматика' : 'grammar', 'гр', true],
                    ] as const
                  ).map(([m, label, mark, needsAi]) => (
                    <button
                      key={m}
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuIdx(null);
                        void runAt(si, sentence, m, 0);
                      }}
                      className="flex items-center gap-2 whitespace-nowrap px-2.5 py-1 font-mono text-2xs text-muted hover:bg-surface-2 hover:text-content"
                    >
                      <span className="w-6 text-teal">{mark}</span>
                      {label}
                      {needsAi && !aiReady && !aiUnknown && <span className="ml-auto pl-2 text-faint">{lang === 'ru' ? 'кеш' : 'cache'}</span>}
                    </button>
                  ))}
                  {/* One explanation for both locked rows, not a repeated hint per row — and it names
                      BOTH ways in, because the same features are free with your own key. Saying only
                      "Pro" here would hide that. */}
                  {!aiReady && !aiUnknown && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuIdx(null);
                        navigate('/pro?from=reader');
                      }}
                      className="whitespace-nowrap px-2.5 pb-1 pt-0.5 text-left font-mono text-2xs text-violet hover:underline"
                    >
                      {lang === 'ru' ? '🔒 нужен ИИ: Pro или свой ключ →' : '🔒 needs AI: Pro or your own key →'}
                    </button>
                  )}
                  {onBookmark && (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setMenuIdx(null);
                        onBookmark(index, si, sentence);
                      }}
                      className="flex items-center gap-2 border-t border-line px-2.5 py-1 font-mono text-2xs text-muted hover:bg-surface-2 hover:text-content"
                    >
                      <span className="w-6 text-center">🔖</span>
                      {bookmarkedSents?.has(si)
                        ? lang === 'ru'
                          ? 'убрать'
                          : 'remove'
                        : lang === 'ru'
                          ? 'заложить'
                          : 'bookmark'}
                    </button>
                  )}
                </span>
              )}
            </span>{' '}
            {/* Marked so the phrase picker can tell the lens OUTPUT from the source text. Without it,
                selecting words inside a Russian translation offered to translate them — into Russian. */}
            {open && (
              <span {...{ [LENS_OUT_ATTR]: true }}>{renderOut(si, sentence)}
                {loading?.idx !== si && out[si]?.kind !== 'fail' && sources[si] && <span className="ml-1 text-xs text-muted">· {translationSourceLabel(sources[si], lang === 'ru')}</span>}
              </span>
            )}
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
  bookmarkedSentences,
  onBookmarkSentence,
  source,
}: {
  paragraphs: string[];
  glossary?: Map<string, Gloss>;
  source?: BookSource;
  /** Book reader only: keys `${para}:${sentence}` bookmarked on this page, and a sentence-level toggle
   *  (invoked from the per-sentence lens menu's "заложить" item). */
  bookmarkedSentences?: Set<string>;
  onBookmarkSentence?: (paraIndex: number, sentenceIndex: number, sentence: string) => void;
}) {
  const canSpeak = useSpeechAvailable();
  const lang = useUiLang((s) => s.lang);
  const ownerRevision = useSyncExternalStore(subscribeDataScope, getDataScopeRevision);
  const wordCards = useSavedWordCards(paragraphs, ownerRevision);
  const ru = lang === 'ru';
  const level = useLearner((s) => s.level);
  const loadVocab = useVocabStore((s) => s.load);
  const coloring = useReaderSettings((s) => s.coloring);
  const toggleColoring = useReaderSettings((s) => s.toggleColoring);
  const fontStep = useReaderSettings((s) => s.fontStep);
  const lineStep = useReaderSettings((s) => s.lineStep);
  const setLineStep = useReaderSettings((s) => s.setLineStep);
  const voiceURI = useReaderSettings((s) => s.voiceURI);
  const setVoiceURI = useReaderSettings((s) => s.setVoiceURI);
  const rate = useReaderSettings((s) => s.rate);
  const setRate = useReaderSettings((s) => s.setRate);
  const aiTranslation = useReaderSettings((s) => s.aiTranslation);
  const toggleAiTranslation = useReaderSettings((s) => s.toggleAiTranslation);
  const aiConfig = useAiStore((s) => s.config);
  const aiConfigured = useAiEnabled();
  const aiUnknown = useAiUnknown();
  // Stable lens callback (reads live mode/config/level via a ref) so the memoized Paragraph gets a constant
  // `onLens` and only re-renders when the primitive `lensK` changes. `translateArgs` still serves the phrase
  // path below.
  const translateArgs = useRef({ ai: aiTranslation, config: aiConfig });
  translateArgs.current = { ai: aiTranslation, config: aiConfig };
  const lensArgs = useRef<LensArgs>({ ai: aiTranslation, config: aiConfig, level });
  lensArgs.current = { ai: aiTranslation, config: aiConfig, level };
  const onLens = useCallback(
    (mode: LensMode, text: string, stepDown?: number, signal?: AbortSignal, onSource?: (source: ReaderTranslation['source']) => void) => runLens(mode, text, lensArgs.current, stepDown, signal, onSource),
    []
  );
  // Re-render + clear cells only when the translate sub-mode or the band changes; the lens mode is
  // now chosen per sentence via the menu.
  const lensK = `${aiTranslation ? 'ai' : 'free'}:${clampBand(level, 0)}`;
  const [voices, setVoices] = useState<Voice[]>(() => listEnglishVoices());
  useEffect(() => {
    // Through the engine, not `window.speechSynthesis` directly: that object does not exist in the
    // Android WebView, so a direct listener never fires and the picker stays empty forever.
    const sync = () => setVoices(listEnglishVoices());
    sync();
    return subscribeVoices(sync);
  }, []);
  const chooseVoice = (uri: string | null) => {
    setVoiceURI(uri);
    previewVoice(uri, VOICE_SAMPLE);
  };
  const typoClass = `${FONT_CLASSES[fontStep] ?? FONT_CLASSES[DEFAULT_FONT_STEP]} ${LEADING_CLASSES[lineStep] ?? LEADING_CLASSES[0]}`;
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
  const [phraseTranslationSource, setPhraseTranslationSource] = useState<ReaderTranslation['source']>();
  const [phraseSentence, setPhraseSentence] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseSaved, setPhraseSaved] = useState(false);
  const [phraseError, setPhraseError] = useState(false);
  const [phraseSaving, setPhraseSaving] = useState(false);
  const phraseRequest = useRef<{
    text: string;
    sentence?: string;
    current: () => boolean;
    result: ReaderTranslation | null;
    backAtSave: string;
    saved: Promise<boolean> | null;
    linking: boolean;
    source?: BookSource;
    controller: AbortController;
  } | null>(null);
  useEffect(
    () => () => {
      if (!phraseRequest.current?.saved) phraseRequest.current?.controller.abort();
      phraseRequest.current = null;
    },
    []
  );
  const pickAnchor = usePhraseSelect((s) => s.anchor);
  const clearPick = usePhraseSelect((s) => s.clear);
  const savedPhrases = useSavedPhrases((s) => s.phrases);
  useEffect(() => subscribeDataScope(() => {
    phraseRequest.current?.controller.abort();
    phraseRequest.current = null;
    clearPick();
    setPhrase(null);
    setPhraseSaved(false);
    setPhraseSaving(false);
    setPhraseError(false);
  }), [clearPick]);

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
    if (!phraseRequest.current?.saved) phraseRequest.current?.controller.abort();
    const request = {
      text,
      sentence,
      current: captureDataScope(),
      result: null as ReaderTranslation | null,
      backAtSave: text,
      saved: null as Promise<boolean> | null,
      linking: false,
      source,
      controller: new AbortController(),
    };
    phraseRequest.current = request;
    setPhrase(text);
    setPhraseSentence(sentence ?? null);
    setPhraseRu(null);
    setPhraseTranslationSource(undefined);
    setPhraseError(false);
    // Already in the word bank → show it as saved instead of offering "+ save" again.
    setPhraseSaved(!source && useSavedPhrases.getState().has(text));
    setPhraseSaving(false);
    setPhraseLoading(true);
    // Pass the phrase's sentence so the AI translates it IN context ("fowling pieces" → "охотничьи
    // ружья", not a literal "кусочки"); the free path ignores the context.
    void translateReaderResult(text, { ...translateArgs.current, sentence, signal: request.controller.signal })
      .then(async (result) => {
        request.result = result;
        if (!request.current()) return;
        if (phraseRequest.current === request) {
          setPhraseRu(result?.text ?? null);
          setPhraseTranslationSource(result?.source);
          setPhraseLoading(false);
        }
        if (
          result &&
          request.saved &&
          (await request.saved) &&
          request.current()
        ) {
          await repairSavedPhrase(
            `phrase:${text.toLowerCase()}`,
            sentence,
            request.backAtSave,
            result,
            request.current
          );
        }
      })
      .catch(() => {
        if (phraseRequest.current === request && request.current())
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
      if (!pickAnchor) cancelPick();
      return;
    }
    // Selecting inside a translation used to fall through to the raw-text branch below and offer to
    // translate Russian into Russian. Nothing here is a word of the book, so there is nothing to look
    // up, save or translate.
    if (inLensOutput(sel.anchorNode) || inLensOutput(sel.focusNode)) {
      if (!pickAnchor) cancelPick();
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
    else if (!pickAnchor) cancelPick();
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
    if (!phraseRequest.current?.saved) phraseRequest.current?.controller.abort();
    phraseRequest.current = null;
    clearPick();
    setPhrase(null);
  };

  const savePhrase = () => {
    const request = phraseRequest.current;
    if (!phrase || !request || request.linking || !request.current()) return;
    request.linking = true;
    setPhraseSaving(true);
    setPhraseError(false);
    request.backAtSave = phraseRu ?? phrase;
    clearPick();
    request.saved ??= addPhraseCard(
      phrase,
      phraseRu ?? phrase,
      phraseSentence ?? undefined,
      undefined,
      request.result?.contextual ? request.result.text : undefined
    );
    void request.saved
      .then(async (saved) => {
        if (!request.current()) return;
        if (saved) useSavedPhrases.getState().add(request.text);
        const linked = saved && (!request.source || await saveReaderTerm(request.source, `phrase:${request.text.toLowerCase()}`, request.sentence, request.current));
        if (!request.current()) return;
        if (phraseRequest.current === request) {
          setPhraseSaved(linked);
          setPhraseError(!linked);
        }
        if (!saved) request.saved = null;
      })
      .catch(() => {
        request.saved = null;
        if (phraseRequest.current === request && request.current())
          setPhraseError(true);
      }).finally(() => {
        request.linking = false;
        if (phraseRequest.current === request && request.current()) setPhraseSaving(false);
      });
  };

  // Per-paragraph bookmarked-sentence sets. Memoized so a non-bookmarked paragraph gets a stable
  // `undefined` and stays memoized; only paragraphs with a bookmark re-render when the set changes.
  const bmByPara = useMemo(() => {
    const m = new Map<number, Set<number>>();
    if (bookmarkedSentences) {
      for (const key of bookmarkedSentences) {
        const [p, s] = key.split(':').map(Number);
        if (p == null || s == null) continue;
        (m.get(p) ?? m.set(p, new Set()).get(p)!).add(s);
      }
    }
    return m;
  }, [bookmarkedSentences]);

  const rankThreshold = rankThresholdFor(level);
  const readerCtx = useMemo<ReaderCtx>(
    () => ({ freq, rankThreshold, coloring, source, ownerRevision, wordCards }),
    [freq, rankThreshold, coloring, source, ownerRevision, wordCards]
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
  const bookmarkRef = useRef(onBookmarkSentence);
  bookmarkRef.current = onBookmarkSentence;
  const onBookmark = useCallback(
    (p: number, s: number, t: string) => bookmarkRef.current?.(p, s, t),
    []
  );

  // Leaving the tab/app stops read-aloud and drops the resume position — the browser cancels speech
  // on hide anyway, and without this the React state would stay stuck on "speaking".
  const stopRef = useRef(stopReading);
  stopRef.current = stopReading;
  useEffect(() => () => stopRef.current(), [ownerRevision]);
  useEffect(() => {
    const onHide = () => {
      if (document.hidden) stopRef.current();
    };
    document.addEventListener('visibilitychange', onHide);
    return () => document.removeEventListener('visibilitychange', onHide);
  }, []);
  // Reset playback when a caller replaces the passage without remounting.
  useEffect(() => {
    stopRef.current();
  }, [paragraphs]);

  return (
    <div className="flex flex-col gap-4">
      <details className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-sm font-semibold text-teal [overflow-wrap:anywhere] [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="transition-transform group-open:rotate-90">▸</span>
          {ru ? 'Настройки чтения' : 'Reader settings'}
        </summary>
        <div className="max-w-sm py-2"><ReaderTextSize /></div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="flex items-center gap-1.5" role="group" aria-label={ru ? 'Межстрочный интервал' : 'Line spacing'}>
          <label className="flex flex-wrap items-center gap-2 text-sm text-muted">
            {ru ? 'Межстрочный интервал' : 'Line spacing'}
            <select value={lineStep} onChange={e => keepReadingAnchor(() => setLineStep(Number(e.target.value)))} className="min-h-11 rounded-sm border border-line bg-surface px-2 text-content">
              <option value={0}>{ru ? 'Обычный' : 'Normal'}</option>
              <option value={1}>{ru ? 'Свободный' : 'Spacious'}</option>
            </select>
          </label>
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
        {canSpeak && voices.length > 0 && (
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
        {canSpeak && (
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
          aria-pressed={aiTranslation}
          title={
            aiConfigured
              ? ru
                ? 'Переводить предложения и фразы через ИИ (текст уходит вашему AI-провайдеру)'
                : 'Translate sentences and phrases with the AI (text is sent to your AI provider)'
              : ru
                ? 'Сохранённые AI-переводы доступны. Для новых нужен trial/Pro или свой ключ.'
                : 'Cached AI translations are available. New translations need trial/Pro or your key.'
          }
          className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
        >
          {aiTranslation
            ? ru
              ? 'фразы и предложения: ИИ'
              : 'phrases and sentences: AI'
            : ru
              ? 'фразы и предложения: бесплатный'
              : 'phrases and sentences: free'}
        </button>
        </div>
        {!aiConfigured && !aiUnknown && (
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-2xs text-muted">
            <span>
              {ru
                ? 'AI-перевод, упрощение и грамматика предложений требуют ключ ИИ (перевод слов и озвучка работают и без него).'
                : 'AI translate, simplify and grammar need an AI key (word lookup and read-aloud work without one).'}
            </span>
            <AiUpsellLink />
          </p>
        )}
      </details>
      {pickAnchor && (
        <div className="sticky top-2 z-10 mb-2 flex items-center gap-3 rounded-sm border border-violet-dim bg-surface-2 px-3 py-2 text-sm shadow-md">
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
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-sm border border-teal-dim bg-surface-2 py-2 pl-3 pr-11 text-sm shadow-md">
          <span className="font-mono text-teal">{phrase}</span>
          {phraseError && (
            <span role="alert" className="text-coral">
              {source ? ru ? 'Не удалось добавить в главу. Попробуйте ещё раз.' : 'Could not add to chapter. Try again.' : ru ? 'Не удалось сохранить' : 'Could not save'}
            </span>
          )}
          {canSpeak && (
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
          {!phraseLoading && phraseRu && phraseTranslationSource && <span className="text-xs text-muted">{translationSourceLabel(phraseTranslationSource, ru)}</span>}
          <button
            type="button"
            disabled={phraseSaved || phraseSaving}
            className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
            onClick={savePhrase}
          >
            {phraseSaving ? ru ? 'сохраняю…' : 'saving…' : phraseSaved
              ? ru
                ? '✓ сохранено'
                : '✓ saved'
              : ru
                ? '+ в словарь'
                : '+ save'}
          </button>
          <button
            type="button"
            aria-label={ru ? 'Закрыть' : 'Dismiss'}
            className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-sm text-xl leading-none text-muted hover:bg-surface hover:text-content focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
            onClick={cancelPick}
          >
            ×
          </button>
        </div>
      )}
      <ReaderContext.Provider value={readerCtx}>
        <PopoverGroup key={ownerRevision}>
          <div
            ref={textRef}
            data-reader-text
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
                aiReady={aiConfigured}
                aiUnknown={aiUnknown}
                lensK={lensK}
                level={level}
                onLens={onLens}
                bookmarkedSents={bmByPara.get(i)}
                onBookmark={onBookmarkSentence ? onBookmark : undefined}
                typoClass={typoClass}
              />
            ))}
          </div>
        </PopoverGroup>
      </ReaderContext.Provider>
    </div>
  );
}
