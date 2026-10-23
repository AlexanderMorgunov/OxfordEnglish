import { useId, useMemo, useState } from 'react';
import { Button, Input } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import type { Crossword, Placed } from './generate';
import { useUiLang } from '@/features/i18n/uiLang';

const key = (r: number, c: number) => `${r},${c}`;

function dropFrom(set: Set<number>, n: number): Set<number> {
  if (!set.has(n)) return set;
  const next = new Set(set);
  next.delete(n);
  return next;
}

function cellsOf(p: Placed): string[] {
  const dr = p.dir === 'down' ? 1 : 0;
  const dc = p.dir === 'across' ? 1 : 0;
  return Array.from({ length: p.word.length }, (_, i) => key(p.row + dr * i, p.col + dc * i));
}

export function CrosswordView({ crossword }: { crossword: Crossword }) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const id = useId();
  const [solved, setSolved] = useState<Set<number>>(new Set());
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const [wrong, setWrong] = useState<Set<number>>(new Set());

  const revealed = useMemo(() => {
    const s = new Set<string>();
    for (const p of crossword.placed) {
      if (solved.has(p.number)) for (const k of cellsOf(p)) s.add(k);
    }
    return s;
  }, [solved, crossword]);

  const startNumber = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of crossword.placed) if (!m.has(key(p.row, p.col))) m.set(key(p.row, p.col), p.number);
    return m;
  }, [crossword]);

  const check = (p: Placed) => {
    const val = (inputs[p.number] ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '');
    if (val === p.word) {
      setSolved((prev) => new Set(prev).add(p.number));
      setWrong((prev) => dropFrom(prev, p.number));
    } else {
      setWrong((prev) => new Set(prev).add(p.number));
    }
  };

  const editClue = (num: number, value: string) => {
    setInputs((s) => ({ ...s, [num]: value }));
    setWrong((prev) => dropFrom(prev, num)); // typing clears the wrong-answer flag
  };

  const across = crossword.placed.filter((p) => p.dir === 'across');
  const down = crossword.placed.filter((p) => p.dir === 'down');
  const allDone = solved.size === crossword.placed.length;

  const clueList = (title: string, list: Placed[]) =>
    list.length > 0 && (
      <div className="flex flex-col gap-2">
        <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">{title}</p>
        {list.map((p) => (
          <div key={p.number} className="flex flex-wrap items-center gap-2">
            <label htmlFor={`${id}-${p.number}`} className="text-sm">
              <span className="font-mono text-2xs tabular-nums text-teal">{p.number}.</span>{' '}{p.clue}
            </label>
            {solved.has(p.number) ? (
              <span role="status" className="font-mono text-2xs text-teal">✓ {p.word.toLowerCase()}</span>
            ) : (
              <span className="flex items-center gap-1.5">
                <Input
                  id={`${id}-${p.number}`}
                  className={cn('w-32', wrong.has(p.number) && 'border-coral text-coral')}
                  aria-invalid={wrong.has(p.number)}
                  value={inputs[p.number] ?? ''}
                  onChange={(e) => editClue(p.number, e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && check(p)}
                />
                <Button size="sm" variant="ghost" aria-label={`${ru ? 'Проверить' : 'Check'} ${p.number}: ${p.clue}`} onClick={() => check(p)}>
                  ✓
                </Button>
                {wrong.has(p.number) && (
                  <span className="font-mono text-2xs text-coral" role="status">
                    {ru ? 'Попробуйте ещё раз' : 'Try again'} · {p.word.length} {ru ? 'букв' : 'letters'}
                  </span>
                )}
              </span>
            )}
          </div>
        ))}
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div
        className="grid w-fit max-w-full gap-0.5 overflow-x-auto"
        tabIndex={0} role="region" aria-label={ru ? 'Сетка кроссворда' : 'Crossword grid'}
        style={{ gridTemplateColumns: `repeat(${crossword.cols}, 1.75rem)` }}
      >
        {crossword.grid.map((row, r) =>
          row.map((cell, c) => {
            if (cell === null) return <div key={key(r, c)} />;
            const num = startNumber.get(key(r, c));
            const show = revealed.has(key(r, c));
            return (
              <div
                key={key(r, c)}
                className="relative flex h-7 w-7 items-center justify-center rounded-[2px] border border-line bg-surface-2 font-mono text-sm uppercase text-teal"
              >
                {num && (
                  <span className="absolute left-0.5 top-0 text-[7px] leading-none text-faint">
                    {num}
                  </span>
                )}
                {show ? cell : ''}
              </div>
            );
          })
        )}
      </div>

      {allDone && <p role="status" className="text-sm text-teal">{ru ? 'Готово — все слова! ✓' : 'Done — all words! ✓'}</p>}

      <div className="flex flex-col gap-3">
        {clueList(ru ? 'по горизонтали' : 'across', across)}
        {clueList(ru ? 'по вертикали' : 'down', down)}
      </div>
    </div>
  );
}
