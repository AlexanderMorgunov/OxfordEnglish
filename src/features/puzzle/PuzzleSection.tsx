import { useMemo, useState } from 'react';
import { SegmentedToggle } from '@/shared/ui';
import { generateCrossword, generateFilword, puzzleWords, type PuzzleEntry } from './generate';
import { CrosswordView } from './CrosswordView';
import { FilwordView } from './FilwordView';

type Mode = 'crossword' | 'filword';

/** Word-grid review built from a word bank — a repetition layer, generated, not
 * authored (env.dev #12). Not counted toward a day's teaching exercises. */
export function PuzzleSection({ entries }: { entries: PuzzleEntry[] }) {
  const [mode, setMode] = useState<Mode>('crossword');
  const words = useMemo(() => puzzleWords(entries), [entries]);
  const crossword = useMemo(() => generateCrossword(entries), [entries]);
  const filword = useMemo(() => generateFilword(entries), [entries]);

  if (words.length < 3) return null;

  return (
    <div className="rounded-lg border border-line bg-surface p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
          повторение сеткой
        </p>
        <SegmentedToggle
          ariaLabel="Тип сетки"
          value={mode}
          onChange={setMode}
          segments={[
            { value: 'crossword', label: 'кроссворд' },
            { value: 'filword', label: 'филворд' },
          ]}
        />
      </div>
      {/* Both stay mounted (inactive one hidden) so switching modes never resets progress. */}
      <div className={mode === 'crossword' ? '' : 'hidden'}>
        <CrosswordView crossword={crossword} />
      </div>
      <div className={mode === 'filword' ? '' : 'hidden'}>
        <FilwordView filword={filword} />
      </div>
    </div>
  );
}
