import { useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import type { Filword } from './generate';

const key = (r: number, c: number) => `${r},${c}`;
const sign = (n: number) => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** Straight line of cells from start to end, or null if not a valid direction. */
function lineCells(r0: number, c0: number, r1: number, c1: number): [number, number][] | null {
  const dr = r1 - r0;
  const dc = c1 - c0;
  if (!(dr === 0 || dc === 0 || Math.abs(dr) === Math.abs(dc))) return null;
  const steps = Math.max(Math.abs(dr), Math.abs(dc));
  const sr = sign(dr);
  const sc = sign(dc);
  return Array.from({ length: steps + 1 }, (_, i) => [r0 + sr * i, c0 + sc * i] as [number, number]);
}

export function FilwordView({ filword }: { filword: Filword }) {
  const [found, setFound] = useState<Set<string>>(new Set());
  const [start, setStart] = useState<[number, number] | null>(null);

  const foundCells = useMemo(() => {
    const s = new Set<string>();
    for (const p of filword.placed) {
      if (found.has(p.word)) for (const [r, c] of p.cells) s.add(key(r, c));
    }
    return s;
  }, [found, filword]);

  const click = (r: number, c: number) => {
    if (!start) {
      setStart([r, c]);
      return;
    }
    const line = lineCells(start[0], start[1], r, c);
    setStart(null);
    if (!line) return;
    const spelled = line.map(([lr, lc]) => filword.grid[lr]![lc]).join('');
    const rev = [...spelled].reverse().join('');
    const hit = filword.placed.find((p) => p.word === spelled || p.word === rev);
    if (hit) setFound((prev) => new Set(prev).add(hit.word));
  };

  const allDone = found.size === filword.placed.length;

  return (
    <div className="flex flex-col gap-4">
      <p className="text-2xs text-muted">
        Найди слова: тапни первую букву, затем последнюю.
      </p>
      <div
        className="grid w-fit gap-0.5"
        style={{ gridTemplateColumns: `repeat(${filword.size}, 1.75rem)` }}
      >
        {filword.grid.map((row, r) =>
          row.map((letter, c) => {
            const isFound = foundCells.has(key(r, c));
            const isStart = start?.[0] === r && start?.[1] === c;
            return (
              <button
                key={key(r, c)}
                type="button"
                onClick={() => click(r, c)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-[2px] border font-mono text-sm uppercase transition-colors',
                  isFound
                    ? 'border-teal-dim bg-teal/20 text-teal'
                    : isStart
                      ? 'border-amber bg-amber-dim/25 text-content'
                      : 'border-line bg-surface-2 text-content hover:border-teal-dim'
                )}
              >
                {letter}
              </button>
            );
          })
        )}
      </div>

      {allDone && <p className="text-sm text-teal">Все слова найдены! ✓</p>}

      <div className="flex flex-wrap gap-1.5">
        {filword.placed.map((p) => (
          <span
            key={p.word}
            className={cn(
              'rounded-sm px-2 py-1 font-mono text-2xs',
              found.has(p.word)
                ? 'bg-teal/15 text-teal line-through'
                : 'bg-surface-2 text-muted'
            )}
          >
            {p.clue}
          </span>
        ))}
      </div>
    </div>
  );
}
