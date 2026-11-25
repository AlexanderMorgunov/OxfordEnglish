import {
  CHANNEL,
  GameFailure,
  RequestSchema,
  capabilities,
  type GameManifest,
  type GameRequest,
} from './contract';

export interface GameTransport {
  send(data: object): void;
  listen(receive: (data: unknown) => void, loaded: () => void, close: () => void): () => void;
}

function frameTransport(frame: HTMLIFrameElement, origin: string): GameTransport {
  return {
    send: (data) => frame.contentWindow?.postMessage(data, origin),
    listen(receive, loaded) {
      const listener = (event: MessageEvent) => {
        if (event.origin === origin && event.source === frame.contentWindow) receive(event.data);
      };
      window.addEventListener('message', listener);
      frame.addEventListener('load', loaded);
      return () => {
        window.removeEventListener('message', listener);
        frame.removeEventListener('load', loaded);
      };
    },
  };
}

export function attachGameBridge({
  frame,
  transport,
  game,
  context,
  handle,
  onReady,
  onInput,
  onClose,
}: {
  frame?: HTMLIFrameElement;
  transport?: GameTransport;
  game: GameManifest;
  context: { locale: 'ru' | 'en'; reducedMotion: boolean };
  handle: (request: GameRequest, signal: AbortSignal) => Promise<unknown>;
  onReady: () => void;
  onInput: () => void;
  onClose: () => void;
}) {
  const origin = new URL(game.entryUrl).origin;
  if (origin === location.origin || origin === 'null')
    throw new GameFailure('invalid_origin');
  if (!transport && !frame) throw new GameFailure('unavailable');
  const endpoint = transport ?? frameTransport(frame!, origin);
  const launchId = crypto.randomUUID();
  let closed = false,
    ready = false,
    count = 0,
    loaded = false;
  const pending = new Map<string, { controller: AbortController; method: GameRequest['method'] }>();
  const seen = new Set<string>();
  const send = (data: object) =>
    endpoint.send({ channel: CHANNEL, version: 1, launchId, ...data });
  const event = (type: 'paused' | 'resumed' | 'closed') =>
    send({ type: 'event', event: { type } });
  const init = setInterval(() => {
    if (!ready) send({ type: 'init' });
  }, 250);
  const limit = setInterval(() => {
    count = 0;
  }, 1000);
  const timeout = setTimeout(() => {
    if (!ready) close();
  }, 20000);
  const reload = () => {
    if (loaded) close();
    else {
      loaded = true;
      send({ type: 'init' });
    }
  };
  const receive = (data: unknown) => {
    if (closed || typeof data !== 'object' || data === null) return;
    const d = data as Record<string, unknown>;
    if (
      !d ||
      d.channel !== CHANNEL ||
      d.version !== 1 ||
      d.launchId !== launchId ||
      ++count > 30
    )
      return;
    if (
      d.type === 'hello' &&
      !ready &&
      d.gameId === game.gameId &&
      d.releaseId === game.releaseId
    ) {
      ready = true;
      clearTimeout(timeout);
      clearInterval(init);
      send({
        type: 'ready',
        context: {
          ...context,
          gameId: game.gameId,
          releaseId: game.releaseId,
          capabilities: transport ? capabilities.filter((name) => name !== 'view.window.v1') : capabilities,
          view: { expanded: Boolean(transport) },
        },
      });
      onReady();
      return;
    }
    if (!ready) return;
    if (d.type === 'input') {
      onInput();
      return;
    }
    if (d.type === 'cancel' && typeof d.requestId === 'string') {
      pending.get(d.requestId)?.controller.abort();
      return;
    }
    const request = RequestSchema.safeParse(d);
    if (!request.success) return;
    const { requestId } = request.data;
    if (seen.has(requestId)) return;
    if (seen.size >= 10000 || pending.size >= 8) {
      send({ type: 'response', requestId, error: { code: 'rate_limit' } });
      return;
    }
    seen.add(requestId);
    const controller = new AbortController();
    pending.set(requestId, { controller, method: request.data.method });
    const timer = setTimeout(() => controller.abort(), 120000);
    void handle(request.data, controller.signal)
      .then(
        (result) => {
          if (!closed && !controller.signal.aborted)
            send({ type: 'response', requestId, result });
        },
        (error) => {
          if (!closed && !controller.signal.aborted)
            send({
              type: 'response',
              requestId,
              error: {
                code:
                  error instanceof GameFailure
                    ? error.code
                    : 'invalid_or_unavailable',
              },
            });
        }
      )
      .finally(() => {
        clearTimeout(timer);
        pending.delete(requestId);
      });
  };
  let detach = () => {};
  function close() {
    if (closed) return;
    event('closed');
    closed = true;
    clearInterval(init);
    clearInterval(limit);
    clearTimeout(timeout);
    detach();
    for (const { controller } of pending.values()) controller.abort();
    pending.clear();
    onClose();
  }
  detach = endpoint.listen(receive, reload, close);
  return {
    close,
    event,
    cancelPrompt: () => {
      for (const [requestId, { controller, method }] of pending) {
        if (!controller.signal.aborted && (method === 'translation.open' || method === 'vocabulary.capture' || method === 'save.resolve')) {
          controller.abort();
          send({ type: 'response', requestId, error: { code: 'cancelled' } });
        }
      }
    },
    suspend: () => {
      event('paused');
      for (const [requestId, { controller, method }] of pending) {
        if (controller.signal.aborted || method === 'save.write') continue;
        controller.abort();
        send({ type: 'response', requestId, error: { code: 'unavailable' } });
      }
    },
    viewChanged: (expanded: boolean) =>
      send({ type: 'event', event: { type: 'view.changed', expanded } }),
  };
}
