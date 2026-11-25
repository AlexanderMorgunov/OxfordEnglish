const CHANNEL = 'dayenglish.game';

export class GameError extends Error {
  constructor(code) {
    super(code);
    this.name = 'GameError';
    this.code = code;
  }
}

export function connectDayEnglish({
  hostOrigin,
  gameId,
  releaseId,
  timeoutMs = 15000,
}) {
  const origin = new URL(hostOrigin).origin;
  if (origin !== hostOrigin || origin === 'null' || window.parent === window)
    throw new GameError('invalid_host');
  let launchId;
  let closed = false;
  let readyContext;
  const pending = new Map();
  const listeners = new Set();
  let resolveReady, rejectReady;
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const readyTimer = setTimeout(() => {
    rejectReady(new GameError('timeout'));
    close();
  }, timeoutMs);
  const send = (data) =>
    window.parent.postMessage(
      { channel: CHANNEL, version: 1, ...data },
      origin
    );
  const receive = (event) => {
    if (closed || event.origin !== origin || event.source !== window.parent)
      return;
    const data = event.data;
    if (!data || data.channel !== CHANNEL || data.version !== 1) return;
    if (data.type === 'init' && typeof data.launchId === 'string') {
      if (launchId && launchId !== data.launchId) {
        close();
        return;
      }
      launchId = data.launchId;
      send({ type: 'hello', launchId, gameId, releaseId });
      return;
    }
    if (!launchId || data.launchId !== launchId) return;
    if (data.type === 'ready' && !readyContext) {
      readyContext = data.context;
      clearTimeout(readyTimer);
      resolveReady(readyContext);
    } else if (data.type === 'response') {
      const task = pending.get(data.requestId);
      if (!task) return;
      pending.delete(data.requestId);
      clearTimeout(task.timer);
      if (data.error) task.reject(new GameError(data.error.code));
      else task.resolve(data.result);
    } else if (data.type === 'event') {
      for (const listener of listeners) listener(data.event);
      if (data.event?.type === 'closed') close();
    }
  };
  function close() {
    if (closed) return;
    closed = true;
    clearTimeout(readyTimer);
    window.removeEventListener('message', receive);
    window.removeEventListener('pointerdown', input);
    window.removeEventListener('keydown', input);
    rejectReady(new GameError('closed'));
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new GameError('closed'));
    }
    pending.clear();
    listeners.clear();
  }
  let lastInput = 0;
  function input(event) {
    if (
      !event.isTrusted ||
      !readyContext ||
      closed ||
      performance.now() - lastInput < 500
    )
      return;
    lastInput = performance.now();
    send({ type: 'input', launchId });
  }
  async function request(method, payload = {}, options = {}) {
    await ready;
    if (closed) throw new GameError('closed');
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        send({ type: 'cancel', launchId, requestId });
        reject(new GameError('timeout'));
      }, options.timeoutMs ?? 120000);
      pending.set(requestId, { resolve, reject, timer });
      send({ type: 'request', launchId, requestId, method, payload });
    });
  }
  window.addEventListener('message', receive);
  window.addEventListener('pointerdown', input);
  window.addEventListener('keydown', input);
  return {
    ready,
    request,
    close,
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
