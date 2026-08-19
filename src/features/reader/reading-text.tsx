import { useEffect, useMemo, useState } from 'react';
import { Button, Popover } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, speakWord, speakPassage, cancelSpeech } from '@/shared/lib/audio';
import { translateWord, translateText } from '@/features/vocab/translate';
import { addWordCard } from '@/features/srs/service';
import { AiAction } from '@/features/ai/AiAction';
import { wordInContext } from '@/features/ai/functions';
import { useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { classifyWord, loadFreq, rankThresholdFor, type FreqIndex, type WordMark } from './difficulty';
import { useReaderSettings } from './settings';

export type Gloss = { ru?: string; ipa?: string };

/** A tappable word: status underline, pronounce, translate (glossary → AI), save to review. */
export function WordToken({
  word,
  gloss,
  sentence,
  highlighted,
  mark,
}: {
  word: string;
  gloss?: Gloss;
  sentence: string;
  highlighted?: boolean;
  /** Precomputed status for coloring (book reader). Falls back to the raw vocab status. */
  mark?: WordMark;
}) {
  const status = useVocabStore((s) => s.statuses.get(word.toLowerCase()));
  const setStatus = useVocabStore((s) => s.setStatus);
  const lang = useUiLang((s) => s.lang);
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
  const raw = mark ?? (status === 'learning' ? 'learning' : status === 'unknown' ? 'new' : undefined);
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
          {lang === 'ru' ? 'перевод недоступен (нет сети?)' : 'translation unavailable (offline?)'}
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
            void addWordCard(word, translation ?? word, undefined);
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
}

function Paragraph({
  text,
  glossary,
  lang,
  speaking,
  activeWord,
  onRead,
  classify,
}: {
  text: string;
  glossary?: Map<string, Gloss>;
  lang: 'en' | 'ru';
  speaking: boolean;
  activeWord: number;
  onRead: () => void;
  classify?: (word: string) => WordMark | undefined;
}) {
  const tokens = useMemo(() => text.split(/(\b[a-zA-Z']+\b)/), [text]);
  const [showTr, setShowTr] = useState(false);
  const [tr, setTr] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  let wordIndex = -1;

  const toggleTr = async () => {
    if (showTr) {
      setShowTr(false);
      return;
    }
    setShowTr(true);
    if (tr === undefined && !loading) {
      setLoading(true);
      setTr(await translateText(text));
      setLoading(false);
    }
  };

  return (
    <div>
      <p className="text-lg leading-relaxed">
        {canSpeak() && (
          <button
            type="button"
            aria-label={
              speaking
                ? lang === 'ru'
                  ? 'Остановить'
                  : 'Stop'
                : lang === 'ru'
                  ? 'Читать с подсветкой слов'
                  : 'Read aloud with word highlighting'
            }
            aria-pressed={speaking}
            className="mr-1.5 align-middle text-teal transition-opacity hover:opacity-80"
            onClick={onRead}
          >
            {speaking ? '⏹' : '🔆'}
          </button>
        )}
        {tokens.map((tok, i) => {
          if (!/^[a-zA-Z']+$/.test(tok)) return <span key={i}>{tok}</span>;
          wordIndex += 1;
          return (
            <WordToken
              key={i}
              word={tok}
              gloss={glossary?.get(tok.toLowerCase())}
              sentence={text}
              highlighted={speaking && wordIndex === activeWord}
              mark={classify?.(tok)}
            />
          );
        })}
      </p>
      <button
        type="button"
        aria-expanded={showTr}
        onClick={() => void toggleTr()}
        className="mt-1 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
      >
        {showTr
          ? lang === 'ru'
            ? 'скрыть перевод'
            : 'hide translation'
          : lang === 'ru'
            ? 'показать перевод'
            : 'show translation'}
      </button>
      {showTr &&
        (loading ? (
          <p className="mt-1 font-mono text-2xs text-faint">
            {lang === 'ru' ? 'перевод…' : 'translating…'}
          </p>
        ) : tr ? (
          <p className="mt-1 text-base leading-relaxed text-muted text-pretty">{tr}</p>
        ) : (
          <p className="mt-1 font-mono text-2xs text-faint">
            {lang === 'ru' ? 'перевод недоступен (нет сети?)' : 'translation unavailable (offline?)'}
          </p>
        ))}
    </div>
  );
}

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
  const statuses = useVocabStore((s) => s.statuses);
  const loadVocab = useVocabStore((s) => s.load);
  const coloring = useReaderSettings((s) => s.coloring);
  const toggleColoring = useReaderSettings((s) => s.toggleColoring);
  const [freq, setFreq] = useState<FreqIndex | null>(null);
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [activeWord, setActiveWord] = useState(-1);

  useEffect(() => {
    void loadVocab();
    void loadFreq().then(setFreq);
  }, [loadVocab]);
  useEffect(() => () => cancelSpeech(), []);

  const rankThreshold = rankThresholdFor(level);
  const classify = useMemo(() => {
    if (!coloring || !freq) return undefined;
    return (w: string): WordMark =>
      classifyWord(w, { status: statuses.get(w.toLowerCase()), freq, rankThreshold });
  }, [coloring, freq, statuses, rankThreshold]);

  const read = (idx: number, text: string) => {
    if (speakingIdx === idx) {
      cancelSpeech();
      setSpeakingIdx(-1);
      setActiveWord(-1);
      return;
    }
    setSpeakingIdx(idx);
    setActiveWord(-1);
    speakPassage(text, {
      onWord: setActiveWord,
      onEnd: () => {
        setSpeakingIdx(-1);
        setActiveWord(-1);
      },
    });
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
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
      {paragraphs.map((p, i) => (
        <Paragraph
          key={i}
          text={p}
          glossary={glossary}
          lang={lang}
          speaking={speakingIdx === i}
          activeWord={activeWord}
          onRead={() => read(i, p)}
          classify={classify}
        />
      ))}
    </div>
  );
}
