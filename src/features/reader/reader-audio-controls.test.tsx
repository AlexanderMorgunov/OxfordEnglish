import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { chunkPassage, speakPassage } from '@/shared/lib/audio';
import { ReadingText } from './reading-text';
import { toSentences } from './parse/text';
import type { ReaderAudioControls } from './ReaderWidget';
import * as location from './reader-location';

vi.mock('@/shared/lib/audio', async (original) => ({
  ...(await original<object>()),
  speakPassage: vi.fn(),
  cancelSpeech: vi.fn(),
  listEnglishVoices: () => [],
  subscribeVoices: () => () => {},
}));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => true,
}));
vi.mock('./difficulty', async (original) => ({
  ...(await original<object>()),
  loadFreq: async () => null,
}));
beforeEach(() => {
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

test('dock next advances whole sentences after split utterances, keeping pause/resume at the actual chunk', async () => {
  const long = `The traveller ${'walked slowly through the forest and '.repeat(9)}reached the house.`;
  const paragraph = `${long} She opened the door. Another sentence follows.`;
  vi.spyOn(location, 'currentReadingLocation').mockReturnValue({
    paragraph: 0,
    sentence: 0,
    text: long,
  });
  let controls: ReaderAudioControls | null = null;
  const current = (): ReaderAudioControls => {
    if (!controls) throw new Error('Missing audio controls');
    return controls;
  };
  const update = vi.fn((value: ReaderAudioControls | null) => {
    controls = value;
  });
  render(
    <ReadingText paragraphs={[paragraph]} onAudioControlsChange={update} />,
    { wrapper: MemoryRouter }
  );
  await waitFor(() => expect(controls?.available).toBe(true));
  await act(async () => controls?.onToggle());
  const calls = vi.mocked(speakPassage);
  const first = calls.mock.calls[0]!;
  expect(first[1]?.startChunk).toBe(0);
  await act(async () => first[1]?.onChunk?.(1));
  await act(async () => controls?.onToggle());
  expect(current().active).toBe(false);
  await act(async () => controls?.onToggle());
  expect(calls.mock.lastCall?.[1]?.startChunk).toBe(1);
  const spoken = toSentences(paragraph).join(' ');
  const chunks = chunkPassage(spoken);
  const second = chunks.findIndex((chunk) => chunk.offset === long.length + 1);
  expect(second).toBeGreaterThan(1);
  await act(async () => controls?.onNext());
  expect(calls.mock.lastCall?.[1]?.startChunk).toBe(second);
  await act(async () => calls.mock.lastCall?.[1]?.onChunk?.(second));
  await act(async () => controls?.onNext());
  const third = chunks.findIndex(
    (chunk) =>
      chunk.offset === long.length + 1 + 'She opened the door.'.length + 1
  );
  expect(calls.mock.lastCall?.[1]?.startChunk).toBe(third);
  await act(async () => calls.mock.lastCall?.[1]?.onChunk?.(third));
  await act(async () => controls?.onNext());
  expect(current().engaged).toBe(false);
  expect(calls).toHaveBeenCalledTimes(4);
});

test('dock starts from the resolved visible sentence instead of restarting its paragraph', async () => {
  const long = `The traveller ${'walked slowly through the forest and '.repeat(9)}reached the house.`;
  const paragraph = `${long} She opened the door.`;
  vi.spyOn(location, 'currentReadingLocation').mockReturnValue({
    paragraph: 0,
    sentence: 1,
    text: 'She opened the door.',
  });
  let controls: ReaderAudioControls | null = null;
  render(
    <ReadingText
      paragraphs={[paragraph]}
      onAudioControlsChange={(value) => {
        controls = value;
      }}
    />,
    { wrapper: MemoryRouter }
  );
  await waitFor(() => expect(controls?.available).toBe(true));
  await act(async () => controls?.onToggle());
  const chunk = chunkPassage(paragraph).findIndex(
    (part) => part.offset === long.length + 1
  );
  expect(vi.mocked(speakPassage).mock.lastCall?.[1]?.startChunk).toBe(chunk);
});

test('dock pauses and resumes a sentence started from its own play button at the actual chunk', async () => {
  const long = `The traveller ${'walked slowly through the forest and '.repeat(9)}reached the house.`;
  let controls: ReaderAudioControls | null = null;
  const current = (): ReaderAudioControls => {
    if (!controls) throw new Error('Missing audio controls');
    return controls;
  };
  render(
    <ReadingText
      paragraphs={[`${long} She opened the door.`]}
      onAudioControlsChange={(value) => {
        controls = value;
      }}
    />,
    { wrapper: MemoryRouter }
  );
  await userEvent.click(
    screen.getByRole('button', { name: 'Play sentence 1' })
  );
  const calls = vi.mocked(speakPassage);
  expect(calls.mock.lastCall?.[0]).toBe(long);
  await act(async () => calls.mock.lastCall?.[1]?.onChunk?.(1));
  await act(async () => controls?.onToggle());
  expect(current().active).toBe(false);
  await act(async () => controls?.onToggle());
  expect(current().active).toBe(true);
  expect(calls.mock.lastCall?.[0]).toBe(long);
  expect(calls.mock.lastCall?.[1]?.startChunk).toBe(1);
});
