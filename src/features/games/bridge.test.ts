import { expect, it, vi } from 'vitest';
import { attachGameBridge } from './bridge';
import { CHANNEL } from './contract';

it('rejects foreign origins, frames and sessions; stops on close', async () => {
  vi.useFakeTimers();
  const frame = document.createElement('iframe');
  document.body.append(frame);
  const handle = vi.fn(async () => ({ ok: true }));
  const ready = vi.fn();
  const post = vi.spyOn(frame.contentWindow!, 'postMessage');
  const bridge = attachGameBridge({
    frame,
    game: {
      gameId: 'test',
      releaseId: '1',
      title: 'test',
      entryUrl: 'https://game.example/',
      skills: [],
      resources: [{ id: 'intro', access: 'public' }],
    },
    context: { locale: 'en', reducedMotion: true },
    handle,
    onReady: ready,
    onInput: vi.fn(),
    onClose: vi.fn(),
  });
  vi.advanceTimersByTime(250);
  const launchId = (post.mock.calls[0]![0] as { launchId: string }).launchId;
  const emit = (
    data: object,
    origin = 'https://game.example',
    source = frame.contentWindow
  ) =>
    window.dispatchEvent(
      new MessageEvent('message', {
        origin,
        source,
        data: { channel: CHANNEL, version: 1, launchId, ...data },
      })
    );
  emit(
    { type: 'hello', gameId: 'test', releaseId: '1' },
    'https://evil.example'
  );
  expect(ready).not.toHaveBeenCalled();
  emit({ type: 'hello', gameId: 'test', releaseId: '1' });
  expect(ready).toHaveBeenCalledOnce();
  const request = {
    type: 'request',
    requestId: crypto.randomUUID(),
    method: 'save.load',
    payload: { slotId: '0' },
  };
  emit(request, 'https://game.example', window);
  emit({ ...request, launchId: crypto.randomUUID() });
  expect(handle).not.toHaveBeenCalled();
  emit(request);
  await Promise.resolve();
  expect(handle).toHaveBeenCalledOnce();
  emit(request);
  expect(handle).toHaveBeenCalledOnce();
  bridge.close();
  emit({ ...request, requestId: crypto.randomUUID() });
  expect(handle).toHaveBeenCalledOnce();
  frame.remove();
  vi.useRealTimers();
});
