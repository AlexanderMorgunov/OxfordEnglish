import 'fake-indexeddb/auto';
import { readFileSync } from 'node:fs';
import { beforeEach, expect, test, vi } from 'vitest';
import {
  AiTaskRequestSchema,
  AI_MAX_INPUT_CHARS,
} from '../../../server/src/contract';
import { inputSize } from '../../../server/src/ai';
import { exercisesMessages } from '../../../server/src/aiPrompts';
import { generateReaderExercises } from './functions';
import { runTask } from './route';
import { complete } from './provider';

vi.mock('./route', () => ({
  runTask: vi.fn(),
  runTaskResult: vi.fn(),
  captureAiScope: () => () => {},
}));
vi.mock('./provider', () => ({ complete: vi.fn() }));

const answer = JSON.stringify([
  { q: 'We read a ___.', options: ['book', 'road'], answer: 'book' },
]);
const book = JSON.parse(
  readFileSync(
    'public/reader/catalog/alice-s-adventures-in-wonderland.json',
    'utf8'
  )
) as { chapters: { text: string }[] };
const text = book.chapters[0]!.text;
const targets = [...new Set(text.toLowerCase().match(/[a-z]{3,}/g))];
beforeEach(() => {
  vi.mocked(runTask).mockReset().mockResolvedValue(answer);
  vi.mocked(complete).mockReset().mockResolvedValue(answer);
});

test('the real long-chapter request fits both wire schemas and the server input budget', async () => {
  expect(text.length).toBeGreaterThan(8000);
  expect(targets.length).toBeGreaterThan(40);
  await generateReaderExercises(null, { text, targets, idPrefix: 'chapter' });
  const request = vi.mocked(runTask).mock.calls[0]![0];
  expect(AiTaskRequestSchema.safeParse(request).success).toBe(true);
  const { AiTaskRequestSchema: clientSchema } =
    await import('@/features/account/contract');
  expect(clientSchema.safeParse(request).success).toBe(true);
  expect(inputSize(request)).toBeLessThanOrEqual(AI_MAX_INPUT_CHARS);
});

test('managed and personal-key prompts use the same bounded excerpt and relevant unique words', async () => {
  vi.mocked(runTask).mockImplementation(async (_request, config, byok) => {
    if (!config) throw new Error('Missing fixture config');
    return byok(config, new AbortController().signal);
  });
  const exercises = await generateReaderExercises(
    {
      provider: 'custom',
      apiKey: 'synthetic',
      model: 'fixture',
      baseUrl: 'https://invalid.example',
    },
    {
      text,
      targets: [
        'Alice',
        'alice',
        'not-in-this-chapter',
        'x'.repeat(9000),
        ...targets,
      ],
      idPrefix: 'chapter',
    }
  );
  const request = vi.mocked(runTask).mock.calls[0]![0];
  expect(request.task).toBe('exercises');
  if (request.task !== 'exercises') throw new Error('Wrong task');
  expect(AiTaskRequestSchema.safeParse(request).success).toBe(true);
  expect(inputSize(request)).toBeLessThanOrEqual(AI_MAX_INPUT_CHARS);
  expect(request.targets.length).toBeLessThanOrEqual(12);
  expect(new Set(request.targets.map((word) => word.toLowerCase())).size).toBe(
    request.targets.length
  );
  expect(request.targets).not.toContain('not-in-this-chapter');
  expect(vi.mocked(complete).mock.calls[0]![1]).toEqual(
    exercisesMessages({ ...request, count: request.count ?? 6 })
  );
  expect(exercises).toHaveLength(1);
});

test.each([
  [0, 1],
  [99, 12],
  [2.8, 2],
  [NaN, 6],
])(
  'exercise count %s remains inside the wire contract',
  async (count, expected) => {
    await generateReaderExercises(null, {
      text: 'Alice reads a book.',
      targets: ['book'],
      count,
      idPrefix: 'chapter',
    });
    const request = vi.mocked(runTask).mock.calls[0]![0];
    expect(AiTaskRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toHaveProperty('count', expected);
  }
);
