import { generateCrossword, generateFilword, puzzleWords } from './generate';

const ENTRIES = [
  { word: 'weather', clue: 'погода' },
  { word: 'rain', clue: 'дождь' },
  { word: 'snow', clue: 'снег' },
  { word: 'wind', clue: 'ветер' },
  { word: 'sunny', clue: 'солнечный' },
  { word: 'trip', clue: 'поездка' },
  { word: 'free time', clue: 'фраза — не берём' },
  { word: 'ok', clue: 'слишком коротко' },
];

test('puzzleWords keeps single letter-only words in range, longest first', () => {
  const w = puzzleWords(ENTRIES);
  expect(w.map((e) => e.word)).not.toContain('FREETIME'); // phrase dropped
  expect(w.map((e) => e.word)).not.toContain('OK'); // too short
  expect(w[0]!.word.length).toBeGreaterThanOrEqual(w[w.length - 1]!.word.length);
  expect(w.every((e) => /^[A-Z]+$/.test(e.word))).toBe(true);
});

test('crossword places words without letter conflicts and interlocks', () => {
  const cw = generateCrossword(ENTRIES);
  for (const p of cw.placed) {
    const dr = p.dir === 'down' ? 1 : 0;
    const dc = p.dir === 'across' ? 1 : 0;
    for (let i = 0; i < p.word.length; i++) {
      expect(cw.grid[p.row + dr * i]![p.col + dc * i]).toBe(p.word[i]);
    }
  }
  // at least the first two words placed (interlock works on this set)
  expect(cw.placed.length).toBeGreaterThanOrEqual(2);
  expect(cw.placed[0]!.number).toBe(1);
});

test('crossword is deterministic', () => {
  expect(generateCrossword(ENTRIES)).toEqual(generateCrossword(ENTRIES));
});

test('filword places every placed word along a straight line matching the grid', () => {
  const fw = generateFilword(ENTRIES);
  expect(fw.placed.length).toBeGreaterThanOrEqual(1);
  for (const p of fw.placed) {
    const spelled = p.cells.map(([r, c]) => fw.grid[r]![c]).join('');
    expect(spelled).toBe(p.word);
  }
  // grid fully filled
  expect(fw.grid.every((row) => row.every((c) => /^[A-Z]$/.test(c)))).toBe(true);
});

test('filword is deterministic', () => {
  expect(generateFilword(ENTRIES)).toEqual(generateFilword(ENTRIES));
});
