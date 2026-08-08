import { useEffect, useMemo, useState } from 'react';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, PixelImage, Popover, SegmentedToggle } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canSpeak, playClip, speakWord } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { addWordCard } from '@/features/srs/service';

type ReadingSection = Extract<Section, { type: 'reading' }>;
type Gloss = { ru?: string; ipa?: string };

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
  useEffect(() => {
    void load();
  }, [load]);

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

      <div className="flex flex-col gap-4">
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

      {section.glossary.length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            glossary
          </p>
          <dl className="flex flex-col gap-2">
            {section.glossary.map((g) => (
              <div key={g.word} className="flex flex-wrap items-baseline gap-2">
                <dt className="font-mono text-sm text-content">{g.word}</dt>
                {canSpeak() && (
                  <button
                    type="button"
                    aria-label={`Pronounce ${g.word}`}
                    className="text-teal transition-opacity hover:opacity-80"
                    onClick={() => speakWord(g.word)}
                  >
                    🔊
                  </button>
                )}
                {g.ipa && <span className="font-mono text-xs text-muted">{g.ipa}</span>}
                {g.ru && <dd className="text-sm text-muted">— {g.ru}</dd>}
              </div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
