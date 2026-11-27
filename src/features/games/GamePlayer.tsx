import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useActivityNavigationGuard } from '@/shared/lib/activity-navigation';
import { z } from 'zod';
import { useUiLang } from '@/features/i18n/uiLang';
import { subscribeDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { isNativePlatform } from '@/shared/lib/platform';
import { SKILL_TAGS } from '@/content/skill-tags';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';
import { lockBodyScroll } from '@/shared/lib/scroll-lock';
import { useGameSave } from './useGameSave';
import {
  AccessSchema,
  AssetSchema,
  CaptureSchema,
  CloudSchema,
  GameFailure,
  LearningSchema,
  SaveWriteSchema,
  SlotSchema,
  TranslationSchema,
  WindowSchema,
  type GameManifest,
  type GameRequest,
} from './contract';
import { attachGameBridge } from './bridge';
import {
  gameScope,
  loadSave,
  recordLearning,
  recordTime,
  writeSave,
} from './storage';
import { gameApi, syncSave } from './api';
import { GameActionDialog, type GamePrompt } from './GameActionDialog';
import { gameAccessAllowed, refreshGameAvailability } from './availability';
import { nativeGameSupported, nativeGameTransport } from './nativeRuntime';
import './games.css';

function exitGameFullscreen(player: HTMLElement) {
  if (document.fullscreenElement === player)
    void document.exitFullscreen().catch(() => {});
}

export function GamePlayer({ game, rollout }: { game: GameManifest; rollout?: 'allowed' | 'suspended' }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const frame = useRef<HTMLIFrameElement>(null);
  const player = useRef<HTMLDivElement>(null);
  const [expandedHeight, setExpandedHeight] = useState(0);
  const expansionRequested = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'loading' | 'ready' | 'closed'>('loading');
  const [prompt, setPrompt] = useState<GamePrompt | null>(null);
  const promptRef = useRef<GamePrompt | null>(null);
  const native = isNativePlatform();
  const nativeSupported = native && nativeGameSupported(game);
  const navigate = useNavigate();
  const backAction = useRef(() => {});
  const foreground = useRef(true);
  const surfaceVisible = useRef(true);
  const nativeView = useRef<ReturnType<typeof nativeGameTransport> | null>(null);
  const [nativeError, setNativeError] = useState<string>();
  const maintenance = game.presentation?.availability === 'maintenance';
  const checkpoint = useGameSave(game.gameId);
  const bridgeRef = useRef<ReturnType<typeof attachGameBridge> | null>(null);
  const leaving = useRef(false);
  const managed = rollout !== undefined;
  const suspended = rollout === 'suspended';
  const retryAccess = useRef<HTMLDivElement>(null);
  const url = new URL(game.entryUrl);
  const allowed =
    url.origin !== location.origin &&
    !url.username &&
    !url.password &&
    (url.protocol === 'https:' ||
      (import.meta.env.DEV &&
        url.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(url.hostname)));
  const blocker = useActivityNavigationGuard(
    state !== 'closed' && (!native || nativeSupported) && !maintenance && allowed && !suspended
  );
  const expanded =
    expandedHeight > 0 &&
    !suspended &&
    state !== 'closed' &&
    !native &&
    !maintenance &&
    allowed;
  useLayoutEffect(() => {
    const container = player.current;
    if (!expanded || !container) return;
    const unlock = lockBodyScroll();
    const gutter = document.documentElement.style.scrollbarGutter;
    document.documentElement.style.scrollbarGutter = 'auto';
    const siblings: { element: HTMLElement; inert: boolean }[] = [];
    // Keep the existing iframe mounted; moving it into a portal reloads the game.
    let branch: HTMLElement = container;
    while (branch.parentElement && branch !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (
          sibling !== branch &&
          sibling instanceof HTMLElement &&
          sibling.tagName !== 'DIALOG'
        ) {
          siblings.push({ element: sibling, inert: sibling.inert });
          sibling.inert = true;
        }
      }
      branch = branch.parentElement;
    }
    const collapse = () => {
      expansionRequested.current = false;
      setExpandedHeight(0);
    };
    const fullscreenChange = (event: Event) => {
      if (event.target === container && document.fullscreenElement !== container)
        collapse();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('dialog[open]'))
        return;
      collapse();
      frame.current?.focus({ preventScroll: true });
    };
    document.addEventListener('keydown', escape);
    document.addEventListener('fullscreenchange', fullscreenChange);
    return () => {
      document.removeEventListener('keydown', escape);
      document.removeEventListener('fullscreenchange', fullscreenChange);
      expansionRequested.current = false;
      exitGameFullscreen(container);
      for (const { element, inert } of siblings) element.inert = inert;
      document.documentElement.style.scrollbarGutter = gutter;
      unlock();
    };
  }, [expanded]);
  useEffect(() => {
    bridgeRef.current?.viewChanged(expanded);
  }, [expanded]);
  useEffect(() => {
    if ((!nativeSupported && !frame.current) || !allowed || maintenance) return;
    const scope = gameScope();
    const hasAccess = () => !managed || gameAccessAllowed();
    const canResume = () => foreground.current && hasAccess() &&
      document.visibilityState === 'visible' && !leaving.current && !promptRef.current;
    let live = true,
      ready = false,
      lastInput = performance.now(),
      lastTick = performance.now();
    const ask = (
      question:
        | { kind: 'capture'; data: z.infer<typeof CaptureSchema> }
        | { kind: 'translation'; data: z.infer<typeof TranslationSchema> }
        | { kind: 'cloud'; data: { gameId: string; slotId: string } },
      signal: AbortSignal
    ): Promise<unknown> => {
      if (promptRef.current) throw new GameFailure('busy');
      return new Promise((resolve, reject) => {
        const finish = (result: unknown) => {
          signal.removeEventListener('abort', cancel);
          promptRef.current = null;
          if (live) setPrompt(null);
          if (canResume())
            bridge.event('resumed');
          try {
            scope.check();
            if (signal.aborted) throw new GameFailure('cancelled');
            resolve(result);
          } catch (e) {
            reject(e);
          }
        };
        const cancel = () => finish({ status: 'cancelled', text: null });
        const next: GamePrompt = {
          ...question,
          scope: {
            owner: scope.owner,
            check() {
              scope.check();
              if (signal.aborted) throw new GameFailure('cancelled');
              if (!hasAccess()) throw new GameFailure('unavailable');
            },
          },
          signal,
          finish,
        };
        promptRef.current = next;
        setPrompt(next);
        bridge.event('paused');
        signal.addEventListener('abort', cancel, { once: true });
        if (signal.aborted) cancel();
      });
    };
    const handle = async (request: GameRequest, signal: AbortSignal) => {
      scope.check();
      if (signal.aborted) throw new GameFailure('cancelled');
      if (!hasAccess()) throw new GameFailure('unavailable');
      if (!foreground.current && request.method !== 'save.write') throw new GameFailure('busy');
      const payload = request.payload;
      switch (request.method) {
        case 'view.set': {
          if (nativeSupported) throw new GameFailure('unavailable');
          if (leaving.current || promptRef.current)
            throw new GameFailure('busy');
          const { expanded: next } = WindowSchema.parse(payload);
          const container = player.current;
          const height = next ? container?.getBoundingClientRect().height || 1 : 0;
          expansionRequested.current = next;
          setExpandedHeight((previous) => next ? previous || height : 0);
          if (
            next && document.fullscreenEnabled && !document.fullscreenElement &&
            container?.requestFullscreen
          ) {
            // The iframe tap activates the host briefly. Request fullscreen before awaiting anything.
            await container.requestFullscreen({ navigationUI: 'hide' }).catch(() => {});
            if (!expansionRequested.current || signal.aborted || !container.isConnected)
              exitGameFullscreen(container);
          }
          return { expanded: expansionRequested.current };
        }
        case 'save.load': {
          const save = await loadSave(
            scope,
            game.gameId,
            SlotSchema.parse(payload).slotId
          );
          return save
            ? {
                revision: save.revision,
                operationId: save.operationId,
                schemaVersion: save.schemaVersion,
                payload: save.payload,
              }
            : null;
        }
        case 'save.write':
          return writeSave(scope, game.gameId, SaveWriteSchema.parse(payload));
        case 'save.cloud': {
          const p = CloudSchema.parse(payload);
          return syncSave({
            owner: scope.owner,
            check() {
              scope.check();
              if (signal.aborted || !hasAccess()) throw new GameFailure('cancelled');
            },
          }, game.gameId, p.slotId, p.direction, signal);
        }
        case 'save.resolve':
          return ask(
            {
              kind: 'cloud',
              data: { gameId: game.gameId, ...SlotSchema.parse(payload) },
            },
            signal
          );
        case 'content.access': {
          const p = AccessSchema.parse(payload);
          const resource = game.resources.find((r) => r.id === p.resourceId);
          if (!resource) throw new GameFailure('not_found');
          if (resource.access === 'public')
            return { allowed: true, reason: 'public' };
          return z
            .object({
              allowed: z.boolean(),
              reason: z.enum(['public', 'pro', 'no_plan']),
              expiresAt: z.number().optional(),
            })
            .parse(
              await gameApi(
                `/${game.gameId}/access`,
                { method: 'POST', signal, body: JSON.stringify(p) },
                scope
              )
            );
        }
        case 'content.asset': {
          const p = AssetSchema.parse(payload);
          return z
            .object({ url: z.string().url(), expiresAt: z.number() })
            .parse(
              await gameApi(
                `/${game.gameId}/asset`,
                { method: 'POST', signal, body: JSON.stringify(p) },
                scope
              )
            );
        }
        case 'vocabulary.capture':
          return ask(
            { kind: 'capture', data: CaptureSchema.parse(payload) },
            signal
          );
        case 'translation.open':
          return ask(
            { kind: 'translation', data: TranslationSchema.parse(payload) },
            signal
          );
        case 'learning.report': {
          const data = LearningSchema.parse(payload);
          if (
            data.skills.some(
              (tag) =>
                !game.skills.includes(tag) ||
                !(SKILL_TAGS as readonly string[]).includes(tag)
            )
          )
            throw new GameFailure('invalid_skill');
          return recordLearning(scope, game.gameId, data);
        }
      }
    };
    const surface = nativeSupported ? nativeGameTransport(
      game, ru ? 'ru' : 'en', !managed || gameAccessAllowed(),
      () => backAction.current(),
      (active) => {
        foreground.current = active;
        lastTick = performance.now();
        if (!active) {
          bridge.event('paused');
          return;
        }
        const resume = () => {
          if (!live || !foreground.current) return;
          const permitted = canResume();
          surface?.show(surfaceVisible.current && permitted);
          bridge.event(permitted ? 'resumed' : 'paused');
        };
        if (managed) void refreshGameAvailability().then(resume);
        else resume();
      },
      (code) => { if (live) setNativeError(code ?? 'unavailable'); },
    ) : undefined;
    nativeView.current = surface ?? null;
    const bridge = attachGameBridge({
      frame: frame.current ?? undefined,
      transport: surface,
      game,
      context: {
        locale: ru ? 'ru' : 'en',
        reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      },
      handle,
      onReady: () => {
        ready = true;
        if (live) setState('ready');
        if (!canResume()) bridge.event('paused');
      },
      onInput: () => {
        lastInput = performance.now();
      },
      onClose: () => {
        ready = false;
        if (live) {
          setState('closed');
          setExpandedHeight(0);
        }
      },
    });
    bridgeRef.current = bridge;
    const close = () => bridge.close();
    const visibility = () => {
      lastTick = performance.now();
      bridge.event(canResume() ? 'resumed' : 'paused');
    };
    document.addEventListener('visibilitychange', visibility);
    const unsubscribe = subscribeDataScope(close);
    const unsubscribeAccount = useAccount.subscribe((s, p) => {
      if (
        s.sessionRevision !== p.sessionRevision ||
        s.accountId !== p.accountId ||
        s.status !== p.status
      )
        close();
    });
    const tick = setInterval(() => {
      const now = performance.now(),
        elapsed = Math.min(5000, Math.max(0, now - lastTick));
      lastTick = now;
      if (
        !ready ||
        !foreground.current ||
        !hasAccess() ||
        leaving.current ||
        promptRef.current ||
        document.visibilityState !== 'visible' ||
        (!nativeSupported && !document.hasFocus()) ||
        now - lastInput > 90000
      )
        return;
      const end = Date.now();
      void recordTime(scope, game.gameId, end - elapsed, end).catch(() => {});
    }, 5000);
    return () => {
      live = false;
      unsubscribe();
      unsubscribeAccount();
      document.removeEventListener('visibilitychange', visibility);
      clearInterval(tick);
      bridge.close();
      bridgeRef.current = null;
      nativeView.current = null;
      promptRef.current = null;
    };
  }, [game, attempt, ru, nativeSupported, allowed, maintenance, managed]);
  useLayoutEffect(() => {
    backAction.current = () => {
      if (blocker.state === 'blocked') blocker.reset();
      else if (promptRef.current) bridgeRef.current?.cancelPrompt();
      else void navigate('/games', { replace: true });
    };
    surfaceVisible.current = !prompt && blocker.state !== 'blocked' && !suspended;
    nativeView.current?.show(surfaceVisible.current && (!managed || gameAccessAllowed()));
  }, [blocker, managed, navigate, prompt, suspended]);
  useLayoutEffect(() => {
    if (!suspended) return;
    bridgeRef.current?.suspend();
    setExpandedHeight(0);
    retryAccess.current?.focus({ preventScroll: true });
  }, [suspended]);
  useEffect(() => {
    leaving.current = blocker.state === 'blocked';
    bridgeRef.current?.event(
      leaving.current ||
        suspended ||
        !foreground.current ||
        promptRef.current ||
        document.visibilityState !== 'visible'
        ? 'paused'
        : 'resumed'
    );
  }, [blocker.state, suspended]);
  useEffect(() => {
    if (state === 'closed' || native || maintenance || !allowed || suspended) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [state, native, maintenance, allowed, suspended]);
  if (maintenance)
    return (
      <p role="status">
        {ru
          ? 'Игра временно недоступна. Сохранения остаются на месте.'
          : 'The game is temporarily unavailable. Your saves are kept.'}
      </p>
    );
  if (native && !nativeSupported)
    return (
      <p>
        {ru
          ? 'Эта версия игры доступна на сайте.'
          : 'This game release is available on the website.'}
      </p>
    );
  if (!allowed)
    return (
      <p role="alert">
        {ru ? 'Адрес игры не разрешён.' : 'Game origin is not allowed.'}
      </p>
    );
  return (
    <div style={expanded ? { height: expandedHeight } : undefined}>
      <div
        ref={player}
        className={`game-player${expanded ? ' game-player--expanded' : ''}`}
      >
        <div className="games-player-toolbar">
          <p role="status">
            {state === 'loading'
              ? ru
                ? 'Подключаем игру…'
                : 'Connecting…'
              : state === 'closed'
                ? ru
                  ? 'Игра отключена. Можно подключиться заново.'
                  : 'Game disconnected. You can reconnect.'
                : checkpoint.state === 'error'
                  ? ru
                    ? 'Не удалось проверить сохранение.'
                    : 'Could not check your save.'
                  : checkpoint.save
                    ? ru
                      ? 'Контрольная точка сохранена на устройстве.'
                      : 'A checkpoint is saved on this device.'
                    : ru
                      ? 'Игра ещё не сохранила контрольную точку.'
                      : 'The game has not saved a checkpoint yet.'}
          </p>
        </div>
        {nativeError && state === 'closed' && <p role="alert">
          {nativeError === 'webview_update'
            ? (ru ? 'Обновите Android System WebView и попробуйте снова.' : 'Update Android System WebView and try again.')
            : (ru ? 'Не удалось загрузить игру. Проверьте подключение и повторите.' : 'Could not load the game. Check your connection and retry.')}
        </p>}
        {suspended && <div className="games-status" tabIndex={-1} ref={retryAccess}>
          <p role="status">{ru ? 'Игра на паузе. Не удалось проверить доступ.' : 'Game paused. Could not check access.'}</p>
          <Button onClick={() => void refreshGameAvailability()}>{ru ? 'Повторить' : 'Retry'}</Button>
          {' '}<Link to="/">{ru ? 'На главную' : 'Go to the homepage'}</Link>
        </div>}
        {state === 'closed' && !suspended && (
          <Button
            onClick={() => {
              setState('loading');
              setNativeError(undefined);
              setPrompt(null);
              setAttempt((a) => a + 1);
            }}
          >
            {ru ? 'Подключиться заново' : 'Reconnect'}
          </Button>
        )}
        {!native && state !== 'closed' && (
          <iframe
            key={`${attempt}-${ru}`}
            ref={frame}
            src={game.entryUrl}
            title={game.title}
            className="game-frame"
            hidden={suspended}
            inert={suspended}
            sandbox="allow-scripts allow-same-origin"
            referrerPolicy="no-referrer"
            allow="camera 'none'; microphone 'none'; geolocation 'none'; payment 'none'"
          />
        )}
        {prompt && !suspended && <GameActionDialog key={prompt.kind} prompt={prompt} />}
        {blocker.state === 'blocked' && (
          <Dialog
            title={ru ? 'Выйти из игры?' : 'Leave the game?'}
            onClose={() => blocker.reset()}
            footer={
              <>
                <Button variant="ghost" onClick={() => blocker.reset()}>
                  {ru ? 'Остаться' : 'Stay'}
                </Button>
                <Button onClick={() => blocker.proceed()}>
                  {ru ? 'Выйти' : 'Leave'}
                </Button>
              </>
            }
          >
            <p>
              {checkpoint.save
                ? ru
                  ? 'Следующий запуск начнётся с последней контрольной точки. Действия после неё могут не сохраниться.'
                  : 'You can resume from the last checkpoint. Later actions may not be saved.'
                : ru
                  ? 'Подтверждённой контрольной точки пока нет. Прогресс этого запуска может потеряться.'
                  : 'No checkpoint has been confirmed yet. Progress from this session may be lost.'}
            </p>
          </Dialog>
        )}
      </div>
    </div>
  );
}
