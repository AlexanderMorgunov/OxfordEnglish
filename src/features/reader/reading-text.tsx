import { createContext, memo, use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Popover } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, speakWord, speakPassage, cancelSpeech } from '@/shared/lib/audio';
import { translateWord, translateText } from '@/features/vocab/translate';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { AiAction } from '@/features/ai/AiAction';
import { wordInContext } from '@/features/ai/functions';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { classifyWord, loadFreq, rankThresholdFor, type FreqIndex, type WordMark } from './difficulty';
import { useReaderSettings, FONT_CLASSES, LEADING_CLASSES } from './settings';
import { toSentences } from './parse/text';

export type Gloss = { ru?: string; ipa?: string };

/** Chapter-level, stable-per-render coloring inputs. Kept in context so a single word's status
 *  change re-renders only that token, not the whole chapter (thousands of WordTokens). */
type ReaderCtx = { freq: FreqIndex | null; rankThreshold: number; coloring: boolean };
const ReaderContext = createContext<ReaderCtx>({ freq: null, rankThreshold: Infinity, coloring: false });

/** A tappable word: status underline, pronounce, translate (glossary → AI), save to review.
 *  Memoized + self-classifying: it subscribes only to its own status, so marking one word never
 *  re-renders its neighbours. */
export const WordToken = memo(function WordToken({
  word,
  gloss,
  sentence,
  highlighted,
}: {
  word: string;
  gloss?: Gloss;
  sentence: string;
  highlighted?: boolean;
}) {
  const status = useVocabStore((s) => s.statuses.get(word.toLowerCase()));
  const setStatus = useVocabStore((s) => s.setStatus);
  const lang = useUiLang((s) => s.lang);
  const { freq, rankThreshold, coloring } = use(ReaderContext);
  const [fetched, setFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [done, setDone] = useState(false);

  const openLookup = () => {
    if (gloss?.ru || done) return;
    setDone(true);
    setLoading(true);
    void translateWord(word).then((ru) => {
      setFetched(ru);
      setFailed(ru === null);
      setLoading(false);
    });
  };
  const translation = gloss?.ru ?? fetched ?? undefined;
  const classified: WordMark | undefined =
    coloring && freq ? classifyWord(word, { status, freq, rankThreshold }) : undefined;
  const raw = classified ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined);
  const visible = raw === 'learning' || raw === 'new' ? raw : undefined;

  return (
    <Popover
      trigger={
        <button
          type="button"
          onClick={openLookup}
          className={cn(
            'cursor-pointer rounded-[2px]',
            visible ? 'underline decoration-2 underline-offset-4' : 'hover:bg-surface-2',
            visible === 'learning' && '[text-decoration-color:var(--color-word-learning)]',
            visible === 'new' && '[text-decoration-color:var(--color-word-unknown)]',
            highlighted && 'bg-teal-dim text-ink'
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
            onClick={() => speakWord(word)}
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
      <div className="mt-2">
        <AiAction
          label={lang === 'ru' ? 'значение в контексте (AI)' : 'meaning in context (AI)'}
          run={(config) => wordInContext(config, word, sentence)}
        />
      </div>
      <div className="mt-2.5 flex flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void setStatus(word, 'learning');
            void addWordCard(word, translation ?? word, sentence);
          }}
        >
          learning
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void setStatus(word, 'known')}>
          known
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void setStatus(word, 'ignored')}
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
  activeWord,
  onRead,
  typoClass,
}: {
  index: number;
  text: string;
  glossary?: Map<string, Gloss>;
  lang: 'en' | 'ru';
  speaking: boolean;
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
            speaking
              ? lang === 'ru'
                ? 'Остановить'
                : 'Stop'
              : lang === 'ru'
                ? 'Читать вслух с этого места'
                : 'Read aloud from here'
          }
          aria-pressed={speaking}
          className="mr-1.5 align-middle text-teal transition-opacity hover:opacity-80"
          onClick={() => onRead(index)}
        >
          {speaking ? '❚❚' : '▶'}
        </button>
      )}
      {sentences.map((sentence, si) => {
        const open = openIdx === si;
        return (
          <span key={si}>
            {sentence.split(/(\b[a-zA-Z']+\b)/).map((tok, i) => {
              if (!/^[a-zA-Z']+$/.test(tok)) return <span key={i}>{tok}</span>;
              wordIndex += 1;
              const idx = wordIndex;
              return (
                <WordToken
                  key={i}
                  word={tok}
                  gloss={glossary?.get(tok.toLowerCase())}
                  sentence={sentence}
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
  const typoClass = `${FONT_CLASSES[fontStep] ?? FONT_CLASSES[1]} ${LEADING_CLASSES[lineStep] ?? LEADING_CLASSES[0]}`;
  const [freq, setFreq] = useState<FreqIndex | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [activeWord, setActiveWord] = useState(-1);
  const playingRef = useRef(false);
  const reduceMotion = useMemo(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
    []
  );

  const textRef = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseRu, setPhraseRu] = useState<string | null>(null);
  const [phraseLoading, setPhraseLoading] = useState(false);
  const [phraseSaved, setPhraseSaved] = useState(false);

  useEffect(() => {
    void loadVocab();
    void loadFreq().then(setFreq);
  }, [loadVocab]);
  useEffect(
    () => () => {
      playingRef.current = false;
      cancelSpeech();
    },
    []
  );

  // A multi-word selection becomes a savable phrase ("took a train"); single-word taps stay
  // on the WordToken popover. English is phrasal-verb/idiom-heavy — word-by-word misleads.
  const onSelect = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ') ?? '';
    const inside = sel?.anchorNode ? (textRef.current?.contains(sel.anchorNode) ?? false) : false;
    if (inside && text.includes(' ') && text.length <= 80) {
      setPhrase(text);
      setPhraseRu(null);
      setPhraseSaved(false);
      setPhraseLoading(true);
      void translateText(text).then((tr) => {
        setPhraseRu(tr);
        setPhraseLoading(false);
      });
    } else {
      setPhrase(null);
    }
  };

  const savePhrase = () => {
    if (!phrase) return;
    setPhraseSaved(true);
    void addPhraseCard(phrase, phraseRu ?? phrase, undefined);
  };

  const rankThreshold = rankThresholdFor(level);
  const readerCtx = useMemo<ReaderCtx>(
    () => ({ freq, rankThreshold, coloring }),
    [freq, rankThreshold, coloring]
  );

  // Continuous read-aloud: after each paragraph ends, advance to the next and scroll it into
  // view. Reading-while-listening works only when playback flows across paragraphs, not stops.
  const scrollToPara = (i: number) => {
    const el = textRef.current?.querySelector(`[data-para="${i}"]`);
    el?.scrollIntoView({ block: 'center', behavior: reduceMotion ? 'auto' : 'smooth' });
  };

  const speakFrom = (i: number) => {
    if (i < 0 || i >= paragraphs.length) {
      stopReading();
      return;
    }
    setSpeakingIdx(i);
    setActiveWord(-1);
    scrollToPara(i);
    speakPassage(paragraphs[i]!, {
      onWord: setActiveWord,
      onEnd: () => {
        if (playingRef.current) speakFrom(i + 1);
      },
    });
  };

  const stopReading = () => {
    playingRef.current = false;
    cancelSpeech();
    setSpeakingIdx(-1);
    setActiveWord(-1);
  };

  const read = (idx: number) => {
    if (playingRef.current && speakingIdx === idx) {
      stopReading();
      return;
    }
    playingRef.current = true;
    speakFrom(idx);
  };
  // Stable identity so a memoized Paragraph isn't re-rendered by a fresh onRead closure each render.
  const readRef = useRef(read);
  readRef.current = read;
  const onRead = useCallback((i: number) => readRef.current(i), []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
      </div>
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
            onClick={() => setPhrase(null)}
          >
            ×
          </button>
        </div>
      )}
      <ReaderContext.Provider value={readerCtx}>
        <div
          ref={textRef}
          className="flex flex-col gap-4"
          onMouseUp={onSelect}
          onTouchEnd={onSelect}
        >
          {paragraphs.map((p, i) => (
            <Paragraph
              key={i}
              index={i}
              text={p}
              glossary={glossary}
              lang={lang}
              speaking={speakingIdx === i}
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
