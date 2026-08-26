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
import { translateWord, translateText } from '@/features/vocab/translate';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { isConfigured, useAiStore } from '@/features/ai/store';
import { wordInContext } from '@/features/ai/functions';
import type { AiConfig } from '@/features/ai/provider';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { classifyWord, loadFreq, rankThresholdFor, type FreqIndex, type WordMark } from './difficulty';
import { useReaderSettings, FONT_CLASSES, LEADING_CLASSES } from './settings';
import { toSentences } from './parse/text';
import { usePhraseSelect, parsePos, samePos, inPhraseRange, type WordPos } from './phrase-select';

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
  highlighted,
}: {
  word: string;
  /** The vocabulary identity (status/glossary/save/pronounce), with edge apostrophes stripped so
   *  "'Tis" tracks as "Tis". Defaults to `word`; `word` is what we display and highlight. */
  lookupWord?: string;
  gloss?: Gloss;
  sentence: string;
  /** Book reader only: `sentence` is a real sentence, so offer a lazy "in context" translation.
   *  Learn sections pass a whole block here and already have a curated translation, so they omit it. */
  enableContextFetch?: boolean;
  /** `${paraIndex}:${sentenceIndex}:${tokenIndex}` — enables phrase selection (book reader only). */
  tokenId?: string;
  highlighted?: boolean;
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
  const raw = classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined);
  const visible = raw === 'learning' || raw === 'new' ? raw : undefined;

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
            visible ? 'underline decoration-2 underline-offset-4' : 'hover:bg-surface-2',
            visible === 'learning' && '[text-decoration-color:var(--color-word-learning)]',
            visible === 'new' && '[text-decoration-color:var(--color-word-unknown)]',
            // cn is plain clsx (no merge) — keep the two backgrounds mutually exclusive.
            highlighted && 'bg-teal-dim text-ink',
            !highlighted && selected && 'bg-violet-dim text-content'
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

const Paragraph = memo(function Paragraph({
  index,
  text,
  glossary,
  lang,
  speaking,
  active,
  activeWord,
  onRead,
  typoClass,
}: {
  index: number;
  text: string;
  glossary?: Map<string, Gloss>;
  lang: 'en' | 'ru';
  /** This paragraph is the current read-aloud one (playing or paused). */
  speaking: boolean;
  /** An utterance is currently in flight for this paragraph — drives the ▶/❚❚ glyph. */
  active: boolean;
  activeWord: number;
  onRead: (index: number) => void;
  typoClass: string;
}) {
  const sentences = useMemo(() => toSentences(text), [text]);
  const [openIdx, setOpenIdx] = useState<number | null>(null);
  const [trs, setTrs] = useState<Record<number, string | null>>({});
  const [loadingIdx, setLoadingIdx] = useState<number | null>(null);
  let wordIndex = -1;

  const toggleSentence = async (idx: number, sentence: string) => {
    if (openIdx === idx) {
      setOpenIdx(null);
      return;
    }
    setOpenIdx(idx); // one at a time — keeps the reading unit small
    if (!(idx in trs) && loadingIdx !== idx) {
      setLoadingIdx(idx);
      const ru = await translateText(sentence);
      setTrs((t) => ({ ...t, [idx]: ru }));
      setLoadingIdx(null);
    }
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
      {sentences.map((sentence, si) => {
        const open = openIdx === si;
        return (
          <span key={si}>
            {sentence.split(WORD_SPLIT_RE).map((tok, i) => {
              if (!WORD_TEST_RE.test(tok)) return <span key={i}>{tok}</span>;
              wordIndex += 1;
              const idx = wordIndex;
              // Must split on the SAME pattern as audio's wordSpans, or the spoken-word index and
              // this rendered index name different tokens and the highlight drifts. Edge apostrophes
              // (opening/closing quotes) are stripped for the vocab identity but kept for display.
              const key = tok.replace(/^'+|'+$/g, '');
              if (!key) {
                return (
                  <span key={i} className={cn(speaking && idx === activeWord && 'bg-teal-dim text-ink')}>
                    {tok}
                  </span>
                );
              }
              return (
                <WordToken
                  key={i}
                  word={tok}
                  lookupWord={key}
                  gloss={glossary?.get(key.toLowerCase())}
                  sentence={sentence}
                  enableContextFetch
                  tokenId={`${index}:${si}:${i}`}
                  highlighted={speaking && idx === activeWord}
                />
              );
            })}
            <button
              type="button"
              aria-label={lang === 'ru' ? 'перевод предложения' : 'translate sentence'}
              aria-pressed={open}
              onClick={() => void toggleSentence(si, sentence)}
              className="ml-0.5 align-super font-mono text-2xs text-teal hover:underline"
            >
              {open ? '×' : 'ru'}
            </button>{' '}
            {open && (
              <span className="text-base text-muted">
                {loadingIdx === si
                  ? `(${lang === 'ru' ? 'перевод…' : 'translating…'})`
                  : trs[si]
                    ? `(${trs[si]}) `
                    : `(${lang === 'ru' ? 'перевод недоступен' : 'translation unavailable'}) `}
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
}: {
  paragraphs: string[];
  glossary?: Map<string, Gloss>;
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
  const highlightSpoken = useReaderSettings((s) => s.highlightSpoken);
  const toggleHighlightSpoken = useReaderSettings((s) => s.toggleHighlightSpoken);
  const readMode = useReaderSettings((s) => s.readMode);
  const setReadMode = useReaderSettings((s) => s.setReadMode);
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
  const [activeWord, setActiveWord] = useState(-1);
  // `speakingActive` = an utterance is in flight (drives the ❚❚ glyph); `playingRef` = a read
  // session is engaged, whether actively speaking or paused mid-paragraph. `resumeChunkRef` is the
  // chunk (sentence) to resume from inside `speakingIdx` — so a pause continues where it stopped
  // instead of restarting the paragraph, and sentence-mode advances one sentence per play.
  const [speakingActive, setSpeakingActive] = useState(false);
  const playingRef = useRef(false);
  const activeRef = useRef(false);
  const resumeChunkRef = useRef(0);
  // Read live in speakFrom's continuation chain (whose onEnd closure is frozen at play time),
  // so mid-read changes to speed/highlight/mode take effect from the next paragraph or sentence.
  const rateRef = useRef(rate);
  rateRef.current = rate;
  const highlightSpokenRef = useRef(highlightSpoken);
  highlightSpokenRef.current = highlightSpoken;
  const readModeRef = useRef(readMode);
  readModeRef.current = readMode;
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

  useEffect(() => {
    void loadVocab();
    void loadFreq().then(setFreq);
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
  // Clear a lingering highlight the moment the toggle is switched off during read-aloud.
  useEffect(() => {
    if (!highlightSpoken) setActiveWord(-1);
  }, [highlightSpoken]);

  const setPhraseText = (text: string, sentence?: string) => {
    setPhrase(text);
    setPhraseSentence(sentence ?? null);
    setPhraseRu(null);
    setPhraseSaved(false);
    setPhraseLoading(true);
    void translateText(text).then((tr) => {
      setPhraseRu(tr);
      setPhraseLoading(false);
    });
  };

  // A multi-word selection becomes a savable phrase ("took a train"); single-word taps stay on the
  // WordToken popover. On touch, native selection is disabled (select-none, coarse pointers) and the
  // phrase is built by tapping — see onPickTap. On a mouse, drag-select still works.
  const onSelect = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ') ?? '';
    const inside = sel?.anchorNode ? (textRef.current?.contains(sel.anchorNode) ?? false) : false;
    if (inside && text.includes(' ') && text.length <= 80) setPhraseText(text);
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
    setActiveWord(-1);
    activeRef.current = true;
    setSpeakingActive(true);
    scrollToPara(i);
    // Speak the exact string the paragraph renders (sentences joined) so audio's word spans line up
    // 1:1 with the rendered word tokens — otherwise the spoken-word highlight drifts.
    const spoken = toSentences(paragraphs[i]!).join(' ');
    speakPassage(spoken, {
      rate: rateRef.current,
      startChunk,
      single: readModeRef.current === 'sentence',
      // Checked per boundary event so toggling the highlight off mid-paragraph stops immediately.
      onWord: (idx) => {
        if (highlightSpokenRef.current) setActiveWord(idx);
      },
      onChunk: (c) => {
        resumeChunkRef.current = c;
      },
      onEnd: (nextChunk, total) => {
        if (!playingRef.current) return;
        if (readModeRef.current === 'sentence') {
          // One sentence spoken — pause and wait for the next play (repeat-after-the-narrator).
          activeRef.current = false;
          setSpeakingActive(false);
          if (nextChunk >= total) {
            const next = i + 1;
            if (next >= paragraphs.length) {
              stopReading();
              return;
            }
            resumeChunkRef.current = 0;
            setSpeakingIdx(next);
            setActiveWord(-1);
            scrollToPara(next);
          } else {
            resumeChunkRef.current = nextChunk;
          }
        } else {
          resumeChunkRef.current = 0;
          speakFrom(i + 1, 0);
        }
      },
    });
  };

  const stopReading = () => {
    playingRef.current = false;
    activeRef.current = false;
    resumeChunkRef.current = 0;
    cancelSpeech();
    setSpeakingActive(false);
    setSpeakingIdx(-1);
    setActiveWord(-1);
  };

  const read = (idx: number) => {
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
    // Fresh start (a different paragraph, or nothing playing).
    resumeChunkRef.current = 0;
    playingRef.current = true;
    speakFrom(idx, 0);
  };
  // Stable identity so a memoized Paragraph isn't re-rendered by a fresh onRead closure each render.
  const readRef = useRef(read);
  readRef.current = read;
  const onRead = useCallback((i: number) => readRef.current(i), []);

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
        {canSpeak() && (
          <div className="flex items-center gap-1.5" role="group" aria-label={ru ? 'Режим озвучки' : 'Read-aloud mode'}>
            <span className="font-mono text-2xs text-muted">{ru ? 'режим' : 'mode'}</span>
            <button
              type="button"
              aria-pressed={readMode === 'paragraph'}
              onClick={() => setReadMode('paragraph')}
              className={cn('font-mono text-2xs hover:underline', readMode === 'paragraph' ? 'text-teal' : 'text-muted')}
            >
              {ru ? 'абзац' : 'paragraph'}
            </button>
            <button
              type="button"
              aria-pressed={readMode === 'sentence'}
              onClick={() => setReadMode('sentence')}
              className={cn('font-mono text-2xs hover:underline', readMode === 'sentence' ? 'text-teal' : 'text-muted')}
              title={ru ? 'по предложению — пауза после каждого, чтобы повторить' : 'sentence-at-a-time — pauses after each so you can repeat'}
            >
              {ru ? 'предложение' : 'sentence'}
            </button>
          </div>
        )}
        {canSpeak() && (
          <button
            type="button"
            onClick={toggleHighlightSpoken}
            aria-pressed={highlightSpoken}
            className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
          >
            {highlightSpoken
              ? ru
                ? 'подсветка слова: вкл'
                : 'spoken word: on'
              : ru
                ? 'подсветка слова: выкл'
                : 'spoken word: off'}
          </button>
        )}
        </div>
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
              lang={lang}
              speaking={speakingIdx === i}
              active={speakingActive && speakingIdx === i}
              activeWord={speakingIdx === i ? activeWord : -1}
              onRead={onRead}
              typoClass={typoClass}
            />
          ))}
        </div>
      </ReaderContext.Provider>
    </div>
  );
}
