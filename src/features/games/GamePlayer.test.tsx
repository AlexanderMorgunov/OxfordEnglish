import { createMemoryRouter, RouterProvider, Link } from 'react-router-dom';
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GamePlayer } from './GamePlayer';
import { attachGameBridge } from './bridge';
import { GameManifestSchema } from './contract';
import lumi from '../../../examples/lumi-catalog.json';
import { RecoveryNavigationGuard } from '@/features/account/RecoveryNavigationGuard';
import { useRecoveryDraft } from '@/features/account/recovery-draft';

vi.mock('./useGameSave', () => ({
  useGameSave: () => ({ state: 'ready', save: null }),
}));
vi.mock('./bridge', () => ({
  attachGameBridge: vi.fn(() => ({
    event: vi.fn(),
    close: vi.fn(),
    viewChanged: vi.fn(),
  })),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function RecoveryDraft() {
  useRecoveryDraft(true);
  return <Link to="/games">Exit with unsaved codes</Link>;
}

it('handles game-owned window controls without reconnecting and restores the surrounding page', async () => {
  const game = GameManifestSchema.parse(lumi[0]);
  const router = createMemoryRouter(
    [
      {
        path: '/play',
        element: (
          <RecoveryNavigationGuard>
            <Link to="/games">Catalogue</Link>
            <GamePlayer game={game} />
          </RecoveryNavigationGuard>
        ),
      },
    ],
    { initialEntries: ['/play'] }
  );
  const view = render(<RouterProvider router={router} />);
  const iframe = screen.getByTitle(game.title);
  const connections = vi.mocked(attachGameBridge).mock.calls.length;
  const previousOverflow = document.body.style.overflow;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: 600,
  } as DOMRect);
  const bridge = vi.mocked(attachGameBridge).mock.calls.at(-1)![0];
  const request = {
    channel: 'dayenglish.game' as const,
    version: 1 as const,
    type: 'request' as const,
    launchId: crypto.randomUUID(),
    requestId: crypto.randomUUID(),
    method: 'view.set' as const,
    payload: { expanded: true },
  };
  await act(async () => {
    expect(await bridge.handle(request, new AbortController().signal)).toEqual({
      expanded: true,
    });
  });
  expect(iframe.closest('.game-player--expanded')).not.toBeNull();
  expect(screen.getByRole('link', { name: 'Catalogue' }).inert).toBe(true);
  expect(document.body.style.overflow).toBe('hidden');
  expect(screen.getByTitle(game.title)).toBe(iframe);
  expect(attachGameBridge).toHaveBeenCalledTimes(connections);
  fireEvent.keyDown(document, { key: 'Escape' });
  expect(document.body.style.overflow).toBe(previousOverflow);
  expect(screen.getByRole('link', { name: 'Catalogue' }).inert).not.toBe(true);
  await expect(
    bridge.handle(
      { ...request, payload: { expanded: 'true' } },
      new AbortController().signal
    )
  ).rejects.toThrow();
  await act(async () => {
    await bridge.handle(request, new AbortController().signal);
  });
  act(() => vi.mocked(attachGameBridge).mock.calls.at(-1)![0].onClose());
  expect(document.body.style.overflow).toBe(previousOverflow);
  expect(document.querySelector('.game-player--expanded')).toBeNull();
  view.unmount();
});

it('gives unsaved account recovery codes priority over the game exit guard', async () => {
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const router = createMemoryRouter(
    [
      {
        path: '/play',
        element: (
          <RecoveryNavigationGuard>
            <RecoveryDraft />
            <GamePlayer game={GameManifestSchema.parse(lumi[0])} />
          </RecoveryNavigationGuard>
        ),
      },
    ],
    { initialEntries: ['/play'] }
  );
  render(<RouterProvider router={router} />);
  fireEvent.click(
    screen.getByRole('link', { name: 'Exit with unsaved codes' })
  );
  expect(
    await screen.findByRole('dialog', { name: 'Save your backup codes' })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('dialog', { name: 'Leave the game?' })
  ).not.toBeInTheDocument();
  expect(warning.mock.calls.flat().join(' ')).not.toMatch(/one blocker/);
  fireEvent.click(screen.getByRole('button', { name: 'Stay and save' }));
  expect(screen.getByTitle('Люми и дорога огней')).toBeInTheDocument();
});

it('does not promise a saved checkpoint after handshake and confirms leaving the game', async () => {
  const NativeRequest = Request;
  // Node Request rejects jsdom's AbortSignal; this router test performs no fetches.
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, signal: undefined });
      }
    }
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const router = createMemoryRouter(
    [
      {
        path: '/play',
        element: (
          <RecoveryNavigationGuard>
            <Link to="/games">Catalogue</Link>
            <GamePlayer game={GameManifestSchema.parse(lumi[0])} />
          </RecoveryNavigationGuard>
        ),
      },
      { path: '/games', element: <p>Back in catalogue</p> },
    ],
    { initialEntries: ['/play'] }
  );
  render(<RouterProvider router={router} />);
  await waitFor(() => expect(attachGameBridge).toHaveBeenCalled());
  const bridge = vi.mocked(attachGameBridge).mock.calls.at(-1)![0];
  act(() => bridge.onReady());
  await screen.findByText('The game has not saved a checkpoint yet.');
  expect(
    screen.queryByText('A checkpoint is saved on this device.')
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Catalogue' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(
    'No checkpoint has been confirmed yet'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(screen.getByTitle('Люми и дорога огней')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('link', { name: 'Catalogue' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Leave' }));
  expect(await screen.findByText('Back in catalogue')).toBeInTheDocument();
});
