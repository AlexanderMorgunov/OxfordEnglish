import { useEffect, useMemo, useState } from 'react';
import { Button, Popover } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, speakWord, speakPassage, cancelSpeech } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { addWordCard } from '@/features/srs/service';
import { AiAction } from '@/features/ai/AiAction';
import { wordInContext } from '@/features/ai/functions';
import { useUiLang } from '@/features/i18n/uiLang';

export type Gloss = { ru?: string; ipa?: string };

/** A tappable word: status underline, pronounce, translate (glossary → AI), save to review. */
export function WordToken({
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
  const [fetched, setFetched] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const openLookup = () => {
    if (gloss?.ru || done) return;
    setDone(true);
    setLoading(true);
    void translateWord(word).then((ru) => {
      setFetched(ru);
      setLoading(false);
    });
  };
  const translation = gloss?.ru ?? fetched ?? undefined;
  const marked = status === 'learning' || status === 'unknown';

  return (
    <Popover
      trigger={
        <button
          type="button"
          onClick={openLookup}
          className={cn(
            'cursor-pointer rounded-[2px]',
            marked ? 'underline decoration-2 underline-offset-4' : 'hover:bg-surface-2',
            status === 'learning' && '[text-decoration-color:var(--color-word-learning)]',
            status === 'unknown' && '[text-decoration-color:var(--color-word-unknown)]',
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
      <div className="mt-2">
        <AiAction
          label={lang === 'ru' ? 'значение в контексте (AI)' : 'meaning in context (AI)'}
          run={(config) => wordInContext(config, word, sentence)}
        />
      </div>
      <div className="mt-2.5 flex gap-1.5">
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
}: {
  text: string;
  glossary?: Map<string, Gloss>;
  lang: 'en' | 'ru';
  speaking: boolean;
  activeWord: number;
  onRead: () => void;
}) {
  const tokens = useMemo(() => text.split(/(\b[a-zA-Z']+\b)/), [text]);
  let wordIndex = -1;
  return (
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
          />
        );
      })}
    </p>
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
  const [speakingIdx, setSpeakingIdx] = useState(-1);
  const [activeWord, setActiveWord] = useState(-1);

  useEffect(() => () => cancelSpeech(), []);

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
      {paragraphs.map((p, i) => (
        <Paragraph
          key={i}
          text={p}
          glossary={glossary}
          lang={lang}
          speaking={speakingIdx === i}
          activeWord={activeWord}
          onRead={() => read(i, p)}
        />
      ))}
    </div>
  );
}
