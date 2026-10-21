import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { claimAudioInput } from './audio-input';
import { playClip, prepareAudioInput, previewVoice, resumeExclusive, speakPassage, speakWord } from './audio';
const { engine } = vi.hoisted(() => ({ engine: { available: () => true, cancel: vi.fn(), cancelForInput: vi.fn(async () => {}), speak: vi.fn(), preview: vi.fn() } }));
vi.mock('./speech', () => ({ speechEngine: () => engine }));
const pause = vi.fn(), play = vi.fn(async () => {});
beforeEach(() => { vi.clearAllMocks(); vi.stubGlobal('Audio', class { pause = pause; play = play; currentTime = 0; playbackRate = 1; }); });
afterEach(() => vi.unstubAllGlobals());
test('input preparation stops owned clip and awaits native acknowledgment; stale passage chunk cannot restart output', async () => {
  speakPassage('First sentence. Second sentence.'); const end = engine.speak.mock.calls.at(-1)?.[1].onEnd as (() => void);
  playClip('/owned.wav'); await prepareAudioInput();
  expect(pause).toHaveBeenCalled(); expect(engine.cancelForInput).toHaveBeenCalledOnce();
  engine.speak.mockClear(); end(); expect(engine.speak).not.toHaveBeenCalled();
});
test.each(['clip','resume','preview','word','passage'])('%s playback cancels microphone ownership before starting output', action => {
  const cancel = vi.fn(); const release = claimAudioInput(cancel); expect(release).not.toBeNull();
  try {
    if(action==='clip') playClip('/owned.wav');
    if(action==='resume') resumeExclusive({ play, pause, currentTime:0 } as unknown as HTMLAudioElement);
    if(action==='preview') previewVoice(null,'Hello');
    if(action==='word') speakWord('Hello');
    if(action==='passage') speakPassage('Hello.');
    expect(cancel).toHaveBeenCalledOnce();
    const output = action==='clip'||action==='resume' ? play : action==='preview' ? engine.preview : engine.speak;
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(output.mock.invocationCallOrder[0]!);
  } finally {release?.();}
});
