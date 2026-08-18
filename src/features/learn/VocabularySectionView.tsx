import { useMemo, useState } from 'react';
import type { Section, VocabEntry } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, SegmentedToggle } from '@/shared/ui';
import { canSpeak, playClip, speakWord } from '@/shared/lib/audio';
import { addWordCard } from '@/features/srs/service';
import { PuzzleSection } from '@/features/puzzle/PuzzleSection';
import { puzzleWords } from '@/features/puzzle/generate';

type VocabularySection = Extract<Section, { type: 'vocabulary' }>;

function WordCard({ entry, testMode }: { entry: VocabEntry; testMode: boolean }) {
  const [revealed, setRevealed] = useState(false);
  const [added, setAdded] = useState(false);
  const play = () =>
    entry.audio ? playClip(packMediaUrl(entry.audio.src)) : speakWord(entry.word);
  const show = !testMode || revealed;

  return (
    <div className="rounded-md border border-line bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-lg text-content">{entry.word}</span>
          {canSpeak() && (
            <button
              type="button"
              aria-label={`Pronounce ${entry.word}`}
              className="text-teal transition-opacity hover:opacity-80"
              onClick={play}
            >
              🔊
            </button>
          )}
          {entry.ipa && <span className="font-mono text-xs text-muted">{entry.ipa}</span>}
        </div>
        <button
          type="button"
          disabled={added}
          className="shrink-0 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
          onClick={() => {
            void addWordCard(entry.word, entry.ru, entry.example);
            setAdded(true);
          }}
        >
          {added ? '✓ in review' : '+ review'}
        </button>
      </div>

      {show ? (
        <div className="mt-2">
          <p className="text-base text-content">{entry.ru}</p>
          {entry.example && (
            <p className="mt-1 text-sm text-muted">
              {entry.example}
              {entry.exampleRu && <span className="text-faint"> — {entry.exampleRu}</span>}
            </p>
          )}
        </div>
      ) : (
        <button
          type="button"
          className="mt-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
          onClick={() => setRevealed(true)}
        >
          reveal
        </button>
      )}
    </div>
  );
}

export function VocabularySectionView({ section }: { section: VocabularySection }) {
  const [mode, setMode] = useState<'study' | 'test'>('study');
  const [showPuzzle, setShowPuzzle] = useState(false);
  const entries = useMemo(
    () => section.words.map((w) => ({ word: w.word, clue: w.ru })),
    [section.words]
  );
  const canPuzzle = puzzleWords(entries).length >= 3;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {section.words.length} words
        </span>
        <div className="flex items-center gap-2.5">
          <SegmentedToggle
            ariaLabel="Vocabulary mode"
            value={mode}
            onChange={setMode}
            segments={[
              { value: 'study', label: 'study' },
              { value: 'test', label: 'test' },
            ]}
          />
          <Button
            size="sm"
            variant="ghost"
            onClick={() =>
              section.words.forEach((w) => void addWordCard(w.word, w.ru, w.example))
            }
          >
            add all to review
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {section.words.map((entry) => (
          <WordCard key={entry.word} entry={entry} testMode={mode === 'test'} />
        ))}
      </div>

      {canPuzzle &&
        (showPuzzle ? (
          <PuzzleSection entries={entries} />
        ) : (
          <button
            type="button"
            className="self-start font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
            onClick={() => setShowPuzzle(true)}
          >
            ▸ повторить сеткой (кроссворд / филворд)
          </button>
        ))}
    </div>
  );
}
