import { useEffect, useMemo, useRef, useState } from 'react';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, PixelImage, Popover, SegmentedToggle } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, playClip, speakWord } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { addWordCard, addPhraseCard } from '@/features/srs/service';

type ReadingSection = Extract<Section, { type: 'reading' }>;
type Gloss = { ru?: string; ipa?: string };

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

function WordToken({ word, gloss }: { word: string; gloss?: Gloss }) {
  const status = useVocabStore((s) => s.statuses.get(word.toLowerCase()));
  const setStatus = useVocabStore((s) => s.setStatus);
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
            marked
              ? 'underline decoration-2 underline-offset-4'
              : 'hover:bg-surface-2',
            status === 'learning' && '[text-decoration-color:var(--color-word-learning)]',
            status === 'unknown' && '[text-decoration-color:var(--color-word-unknown)]'
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

function ReadingBlock({
  en,
  ru,
  audioUrl,
  rate,
  glossary,
}: {
  en: string;
  ru?: string;
  audioUrl?: string;
  rate: number;
  glossary: Map<string, Gloss>;
}) {
  const [showRu, setShowRu] = useState(false);
  const tokens = useMemo(() => en.split(/(\b[a-zA-Z']+\b)/), [en]);

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
        {tokens.map((tok, i) =>
          /^[a-zA-Z']+$/.test(tok) ? (
            <WordToken key={i} word={tok} gloss={glossary.get(tok.toLowerCase())} />
          ) : (
            <span key={i}>{tok}</span>
          )
        )}
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
  const [rateKey, setRateKey] = useState<ReadingRateKey>('0.75');
  const textRef = useRef<HTMLDivElement>(null);
  const [phrase, setPhrase] = useState<string | null>(null);
  const [phraseSaved, setPhraseSaved] = useState(false);
  useEffect(() => {
    void load();
  }, [load]);

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
            rate={READING_RATES[rateKey]}
            glossary={glossary}
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
