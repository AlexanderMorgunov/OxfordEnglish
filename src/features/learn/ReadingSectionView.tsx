import { useEffect, useMemo, useState } from 'react';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, PixelImage, Popover } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { canPronounce, pronounce } from '@/features/vocab/pronounce';
import { addWordCard } from '@/features/srs/service';

type ReadingSection = Extract<Section, { type: 'reading' }>;
type Gloss = { ru?: string; ipa?: string };

function WordToken({ word, gloss }: { word: string; gloss?: Gloss }) {
  const status = useVocabStore((s) => s.statuses.get(word.toLowerCase()));
  const setStatus = useVocabStore((s) => s.setStatus);

  const marked = status === 'learning' || status === 'unknown';
  return (
    <Popover
      trigger={
        <button
          type="button"
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
        {canPronounce() && (
          <button
            type="button"
            aria-label={`Pronounce ${word}`}
            className="text-teal transition-opacity hover:opacity-80"
            onClick={() => pronounce(word)}
          >
            🔊
          </button>
        )}
      </div>
      {gloss?.ipa && <p className="font-mono text-xs text-muted">{gloss.ipa}</p>}
      {gloss?.ru && <p className="mt-1 text-sm text-content">{gloss.ru}</p>}
      <div className="mt-2.5 flex gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            void setStatus(word, 'learning');
            void addWordCard(word, gloss?.ru ?? word, undefined);
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
  glossary,
}: {
  en: string;
  ru?: string;
  audioUrl?: string;
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
            onClick={() => void new Audio(audioUrl).play()}
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

export function ReadingSectionView({ section }: { section: ReadingSection }) {
  const load = useVocabStore((s) => s.load);
  useEffect(() => {
    void load();
  }, [load]);

  const glossary = useMemo(
    () => new Map(section.glossary.map((g) => [g.word.toLowerCase(), { ru: g.ru, ipa: g.ipa }])),
    [section.glossary]
  );

  return (
    <div className="flex flex-col gap-4">
      {section.image && (
        <PixelImage
          src={packMediaUrl(section.image.src)}
          alt={section.image.alt?.en ?? section.title.en}
          className="w-full rounded-md border border-line"
        />
      )}

      <div className="flex flex-col gap-4">
        {section.blocks.map((block) => (
          <ReadingBlock
            key={block.id}
            en={block.en}
            ru={block.ru}
            audioUrl={block.audio ? packMediaUrl(block.audio.src) : undefined}
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
                {canPronounce() && (
                  <button
                    type="button"
                    aria-label={`Pronounce ${g.word}`}
                    className="text-teal transition-opacity hover:opacity-80"
                    onClick={() => pronounce(g.word)}
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
