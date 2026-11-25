import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import type { GameManifest } from './contract';
import type { GameTransport } from './bridge';

interface RuntimeEvent {
  session: string;
  kind: 'loaded' | 'message' | 'back' | 'failed' | 'foreground' | 'background';
  payload?: string;
}

interface GameRuntimePlugin {
  open(options: Pick<GameManifest, 'gameId' | 'releaseId' | 'entryUrl'> & {
    session: string; locale: 'ru' | 'en'; visible: boolean;
  }): Promise<void>;
  close(options: { session: string }): Promise<void>;
  show(options: { session: string; visible: boolean }): Promise<void>;
  send(options: { session: string; payload: string }): Promise<void>;
  addListener(name: 'gameEvent', listener: (event: RuntimeEvent) => void): Promise<PluginListenerHandle>;
}

const runtime = registerPlugin<GameRuntimePlugin>('GameRuntime');
const gameId = 'lumi-road-of-lights';
const nativeOrigin = 'https://lumi.games.dayenglish.ru';

export function nativeGameSupported(game: GameManifest): boolean {
  return Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('GameRuntime') &&
    game.gameId === gameId && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(game.releaseId) &&
    game.entryUrl === `${nativeOrigin}/games/${gameId}/releases/${game.releaseId}/index.html`;
}

export function nativeGameTransport(
  game: GameManifest,
  locale: 'ru' | 'en',
  visible: boolean,
  onBack: () => void,
  onForeground: (active: boolean) => void,
  onFailure: (code?: string) => void,
) {
  const session = crypto.randomUUID();
  let disposed = false;
  let show = visible;
  let opened = false;
  let subscription: PluginListenerHandle | undefined;
  function dispose() {
    if (disposed) return;
    disposed = true;
    void subscription?.remove().catch(() => undefined);
    void runtime.close({ session }).catch(() => undefined);
  }
  const transport: GameTransport = {
    send(payload) {
      if (opened && !disposed)
        void runtime.send({ session, payload: JSON.stringify(payload) }).catch(() => undefined);
    },
    listen(receive, loaded, close) {
      void (async () => {
        try {
          const listener = await runtime.addListener('gameEvent', (event) => {
            if (disposed || event.session !== session) return;
            switch (event.kind) {
              case 'loaded': loaded(); break;
              case 'back': onBack(); break;
              case 'failed': onFailure(); close(); break;
              case 'foreground': onForeground(true); break;
              case 'background': onForeground(false); break;
              case 'message':
                if (event.payload) receive(JSON.parse(event.payload));
                break;
            }
          });
          if (disposed) {
            await listener.remove();
            return;
          }
          subscription = listener;
          await runtime.open({
            session, gameId: game.gameId, releaseId: game.releaseId, entryUrl: game.entryUrl, locale, visible: show,
          });
          opened = true;
          if (disposed) await runtime.close({ session });
          else await runtime.show({ session, visible: show });
        } catch (error) {
          if (disposed) return;
          onFailure((error as { code?: string }).code);
          close();
        }
      })();
      return dispose;
    },
  };
  return {
    ...transport,
    show(visibleNow: boolean) {
      show = visibleNow;
      if (opened && !disposed)
        void runtime.show({ session, visible: show }).catch(() => undefined);
    },
  };
}
