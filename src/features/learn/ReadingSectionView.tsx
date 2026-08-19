import { useEffect, useMemo, useRef, useState } from 'react';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { PixelImage, SegmentedToggle } from '@/shared/ui';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, playClip, speakWord, speakPassage, cancelSpeech } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { addWordCard, addPhraseCard } from '@/features/srs/service';
import { useUiLang } from '@/features/i18n/uiLang';
import { WordToken, type Gloss } from '@/features/reader/reading-text';

type ReadingSection = Extract<Section, { type: 'reading' }>;

function GlossaryRow({ word, ipa, ru }: { word: string; ipa?: string; ru?: string }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="font-mono text-sm text-content">{word}</dt>
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
      {ipa && <span className="font-mono text-xs text-muted">{ipa}</span>}
      {ru && <dd className="text-sm text-muted">— {ru}</dd>}
      <button
        type="button"
        disabled={saved}
        className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
        onClick={() => {
          void addWordCard(word, ru ?? word, undefined);
          setSaved(true);
        }}
      >
        {saved ? '✓ в повторении' : '+ review'}
      </button>
    </div>
  );
}

function ReadingBlock({
  en,
  ru,
  audioUrl,
  rate,
  glossary,
  lang,
  speaking,
  activeWord,
  onRead,
}: {
  en: string;
  ru?: string;
  audioUrl?: string;
  rate: number;
  glossary: Map<string, Gloss>;
  lang: 'en' | 'ru';
  speaking: boolean;
  activeWord: number;
  onRead: () => void;
}) {
  const [showRu, setShowRu] = useState(false);
  const tokens = useMemo(() => en.split(/(\b[a-zA-Z']+\b)/), [en]);

  let wordIndex = -1;

  return (
    <div className="border-b border-line pb-4 last:border-b-0">
      <p className="text-lg leading-relaxed">
        {audioUrl && (
          <button
            type="button"
            aria-label="Play paragraph"
            className="mr-1.5 align-middle text-teal transition-opacity hover:opacity-80"
            onClick={() => playClip(audioUrl, rate)}
          >
            ▶
          </button>
        )}
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
              gloss={glossary.get(tok.toLowerCase())}
              sentence={en}
              highlighted={speaking && wordIndex === activeWord}
            />
          );
        })}
      </p>
      {ru && (
        <div className="mt-2">
          {showRu ? (
            <p className="text-base text-muted text-pretty">{ru}</p>
          ) : (
            <button
              type="button"
              className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
              onClick={() => setShowRu(true)}
            >
              show translation
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const READING_RATES = { '0.75': 0.75, '1': 1, '1.25': 1.25 } as const;
type ReadingRateKey = keyof typeof READING_RATES;

export function ReadingSectionView({ section }: { section: ReadingSection }) {
  const load = useVocabStore((s) => s.load);
  const lang = useUiLang((s) => s.lang);
  const [rateKey, setRateKey] = useState<ReadingRateKey>('0.75');
  const textRef = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseSaved, setPhraseSaved] = useState(false);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const [activeWord, setActiveWord] = useState(-1);
  useEffect(() => {
    void load();
  }, [load]);

  // Only one paragraph reads at a time (speech synthesis is global); stop on unmount.
  useEffect(() => () => cancelSpeech(), []);

  const rate = READING_RATES[rateKey];
  const readBlock = (id: string, text: string) => {
    if (speakingId === id) {
      cancelSpeech();
      setSpeakingId(null);
      setActiveWord(-1);
      return;
    }
    setSpeakingId(id);
    setActiveWord(-1);
    speakPassage(text, {
      rate,
      onWord: setActiveWord,
      onEnd: () => {
        setSpeakingId(null);
        setActiveWord(-1);
      },
    });
  };

  // A multi-word selection inside the reading text becomes a savable phrase
  // ("took a train") — the single-word path is the WordToken popover.
  const onSelect = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim().replace(/\s+/g, ' ') ?? '';
    const inside = sel?.anchorNode && textRef.current?.contains(sel.anchorNode);
    if (inside && text.includes(' ') && text.length <= 60) {
      setPhrase(text);
      setPhraseSaved(false);
    } else {
      setPhrase(null);
    }
  };

  const savePhrase = () => {
    if (!phrase) return;
    setPhraseSaved(true);
    void translateWord(phrase).then((ru) => addPhraseCard(phrase, ru ?? phrase, undefined));
  };

  const glossary = useMemo(
    () => new Map(section.glossary.map((g) => [g.word.toLowerCase(), { ru: g.ru, ipa: g.ipa }])),
    [section.glossary]
  );
  const hasAudio = section.blocks.some((b) => b.audio);

  return (
    <div className="flex flex-col gap-4">
      {section.image && (
        <PixelImage
          src={packMediaUrl(section.image.src)}
          alt={section.image.alt?.en ?? section.title.en}
          className="w-full rounded-md border border-line"
        />
      )}

      {hasAudio && canSpeak() && (
        <div className="flex items-center gap-2.5">
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            audio speed
          </span>
          <SegmentedToggle
            ariaLabel="Reading audio speed"
            value={rateKey}
            onChange={setRateKey}
            segments={[
              { value: '0.75', label: '0.75×' },
              { value: '1', label: '1×' },
              { value: '1.25', label: '1.25×' },
            ]}
          />
        </div>
      )}

      {phrase && (
        <div className="sticky top-2 z-10 flex flex-wrap items-center gap-2 rounded-sm border border-teal-dim bg-surface-2 px-3 py-2 text-sm shadow-md">
          <span className="text-muted">Фраза:</span>
          <span className="font-mono text-teal">{phrase}</span>
          <button
            type="button"
            disabled={phraseSaved}
            className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
            onClick={savePhrase}
          >
            {phraseSaved ? '✓ сохранено' : '+ в словарь'}
          </button>
        </div>
      )}

      <div
        ref={textRef}
        className="flex flex-col gap-4"
        onMouseUp={onSelect}
        onTouchEnd={onSelect}
      >
        {section.blocks.map((block) => (
          <ReadingBlock
            key={block.id}
            en={block.en}
            ru={block.ru}
            audioUrl={block.audio ? packMediaUrl(block.audio.src) : undefined}
            rate={rate}
            glossary={glossary}
            lang={lang}
            speaking={speakingId === block.id}
            activeWord={activeWord}
            onRead={() => readBlock(block.id, block.en)}
          />
        ))}
      </div>

      {section.attribution && (
        <p className="font-mono text-2xs text-faint">source: {section.attribution}</p>
      )}

      {section.glossary.length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            glossary
          </p>
          <dl className="flex flex-col gap-2">
            {section.glossary.map((g) => (
              <GlossaryRow key={g.word} word={g.word} ipa={g.ipa} ru={g.ru} />
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
