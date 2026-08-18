export type PuzzleEntry = { word: string; clue: string };

export type Placed = {
  word: string;
  clue: string;
  row: number;
  col: number;
  dir: 'across' | 'down';
  number: number;
};

export type Crossword = {
  cols: number;
  rows: number;
  /** letter per cell, null = blocked */
  grid: (string | null)[][];
  placed: Placed[];
  dropped: number;
};

export type FilwordPlaced = { word: string; clue: string; cells: [number, number][] };
export type Filword = {
  size: number;
  grid: string[][];
  placed: FilwordPlaced[];
};

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic PRNG so a given word set always yields the same puzzle. */
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Single-word, letters-only entries, longest first, capped. */
export function puzzleWords(entries: PuzzleEntry[], max = 8): PuzzleEntry[] {
  const seen = new Set<string>();
  const out: PuzzleEntry[] = [];
  for (const e of entries) {
    if (/\s/.test(e.word.trim())) continue; // phrases don't grid well
    const word = e.word.toUpperCase().replace(/[^A-Z]/g, '');
    if (word.length < 3 || word.length > 11 || seen.has(word)) continue;
    seen.add(word);
    out.push({ word, clue: e.clue });
  }
  return out.sort((a, b) => b.word.length - a.word.length).slice(0, max);
}

export function generateCrossword(entries: PuzzleEntry[]): Crossword {
  const words = puzzleWords(entries);
  const cells = new Map<string, string>();
  const key = (r: number, c: number) => `${r},${c}`;
  const placed: Placed[] = [];

  const fits = (word: string, r: number, c: number, dir: 'across' | 'down'): boolean => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    // cell before start and after end must be empty (no word concatenation)
    if (cells.has(key(r - dr, c - dc))) return false;
    if (cells.has(key(r + dr * word.length, c + dc * word.length))) return false;
    for (let i = 0; i < word.length; i++) {
      const cr = r + dr * i;
      const cc = c + dc * i;
      const existing = cells.get(key(cr, cc));
      if (existing) {
        if (existing !== word[i]) return false; // conflict
      } else {
        // empty cell: its perpendicular neighbours must be empty too
        const pr = dir === 'across' ? 1 : 0;
        const pc = dir === 'across' ? 0 : 1;
        if (cells.has(key(cr + pr, cc + pc)) || cells.has(key(cr - pr, cc - pc))) return false;
      }
    }
    return true;
  };

  const put = (word: string, clue: string, r: number, c: number, dir: 'across' | 'down') => {
    const dr = dir === 'down' ? 1 : 0;
    const dc = dir === 'across' ? 1 : 0;
    for (let i = 0; i < word.length; i++) cells.set(key(r + dr * i, c + dc * i), word[i]!);
    placed.push({ word, clue, row: r, col: c, dir, number: 0 });
  };

  let dropped = 0;
  words.forEach((entry, idx) => {
    if (idx === 0) {
      put(entry.word, entry.clue, 0, 0, 'across');
      return;
    }
    let done = false;
    for (const p of placed) {
      for (let pi = 0; pi < p.word.length && !done; pi++) {
        for (let wi = 0; wi < entry.word.length && !done; wi++) {
          if (p.word[pi] !== entry.word[wi]) continue;
          const dir = p.dir === 'across' ? 'down' : 'across';
          const cellR = p.dir === 'across' ? p.row : p.row + pi;
          const cellC = p.dir === 'across' ? p.col + pi : p.col;
          const r = dir === 'down' ? cellR - wi : cellR;
          const c = dir === 'across' ? cellC - wi : cellC;
          if (fits(entry.word, r, c, dir)) {
            put(entry.word, entry.clue, r, c, dir);
            done = true;
          }
        }
      }
    }
    if (!done) dropped++;
  });

  let minR = 0;
  let minC = 0;
  let maxR = 0;
  let maxC = 0;
  for (const k of cells.keys()) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    minR = Math.min(minR, r);
    minC = Math.min(minC, c);
    maxR = Math.max(maxR, r);
    maxC = Math.max(maxC, c);
  }
  const rows = maxR - minR + 1;
  const cols = maxC - minC + 1;
  const grid: (string | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null as string | null)
  );
  for (const [k, v] of cells) {
    const [r, c] = k.split(',').map(Number) as [number, number];
    grid[r - minR]![c - minC] = v;
  }
  const shifted = placed
    .map((p) => ({ ...p, row: p.row - minR, col: p.col - minC }))
    .sort((a, b) => a.row - b.row || a.col - b.col)
    .map((p, i) => ({ ...p, number: i + 1 }));

  return { rows, cols, grid, placed: shifted, dropped };
}

const DIRS: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

export function generateFilword(entries: PuzzleEntry[]): Filword {
  const words = puzzleWords(entries, 8);
  const rand = mulberry32(hashStr(words.map((w) => w.word).join('|')));
  const longest = words.reduce((m, w) => Math.max(m, w.word.length), 0);
  const total = words.reduce((s, w) => s + w.word.length, 0);
  const size = Math.max(longest, Math.ceil(Math.sqrt(total * 1.7)), 8);
  const grid: (string | null)[][] = Array.from({ length: size }, () =>
    Array.from({ length: size }, () => null as string | null)
  );
  const placed: FilwordPlaced[] = [];

  const tryPlace = (word: string, clue: string): boolean => {
    for (let attempt = 0; attempt < 120; attempt++) {
      const [dr, dc] = DIRS[Math.floor(rand() * DIRS.length)]!;
      const r0 = Math.floor(rand() * size);
      const c0 = Math.floor(rand() * size);
      const rEnd = r0 + dr * (word.length - 1);
      const cEnd = c0 + dc * (word.length - 1);
      if (rEnd < 0 || rEnd >= size || cEnd < 0 || cEnd >= size) continue;
      let ok = true;
      for (let i = 0; i < word.length; i++) {
        const cur = grid[r0 + dr * i]![c0 + dc * i];
        if (cur && cur !== word[i]) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      const cellList: [number, number][] = [];
      for (let i = 0; i < word.length; i++) {
        const r = r0 + dr * i;
        const c = c0 + dc * i;
        grid[r]![c] = word[i]!;
        cellList.push([r, c]);
      }
      placed.push({ word, clue, cells: cellList });
      return true;
    }
    return false;
  };

  for (const w of words) tryPlace(w.word, w.clue);

  const filled: string[][] = grid.map((row) =>
    row.map((cell) => cell ?? LETTERS[Math.floor(rand() * 26)]!)
  );
  return { size, grid: filled, placed };
}
