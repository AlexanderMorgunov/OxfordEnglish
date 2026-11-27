import { useEffect, useRef } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useNavigate,
} from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { useAccount } from '@/features/account/store';
import {
  connectGameAvailability,
  refreshGameAvailability,
} from '@/features/games/availability';
import { AnnouncementsPage } from '@/pages/AnnouncementsPage';
import { GamesPage } from '@/pages/GamesPage';
import fixture from '../../../examples/lumi-catalog.json';
import { AnnouncementSlot } from './AnnouncementSlot';
import { ProductAnnouncements } from './ProductAnnouncements';
import { AnnouncementContext } from './model';
import type { Announcement } from './model';

vi.mock('@/features/account/config', () => ({
  API_BASE: 'https://api.test',
  accountsEnabled: () => true,
}));

const title = 'Our first game · Lumi and the Road of Lights';
const [lumi] = fixture;
if (!lumi) throw new Error('Missing Lumi catalogue fixture');
const account = useAccount.getState();
let decision = true;
let catalogFails = false;
let games: unknown[] = fixture;

function useApi() {
  decision = true;
  catalogFails = false;
  games = fixture;
  useAccount.setState({
    getAccessToken: async () => useAccount.getState().accountId,
  });
  const request = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith('/v1/features')) {
      return Response.json({
        version: 1,
        validForMs: 30_000,
        features: {
          games_catalog: {
            allowed:
              decision &&
              new Headers(init?.headers).get('authorization') ===
                'Bearer tester',
            revision: 1,
          },
        },
      });
    }
    if (url.endsWith('/v1/games/catalog')) {
      if (catalogFails) return Response.json({}, { status: 503 });
      return Response.json({ version: 1, games });
    }
    throw new Error(`Unexpected API request ${url}`);
  });
  vi.stubGlobal('fetch', request);
  return request;
}

function setAccount(accountId: string | null) {
  useAccount.setState((state) => ({
    accountId,
    status: accountId ? 'authenticated' : 'anonymous',
    sessionRevision: state.sessionRevision + 1,
  }));
}

function Home() {
  const primary = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={primary}>Start day</button>
      <AnnouncementSlot
        placement="today"
        onDismiss={() => primary.current?.focus()}
      />
      <Link to="/updates">Updates</Link>
    </>
  );
}

function Back() {
  const navigate = useNavigate();
  return <button onClick={() => void navigate(-1)}>Back</button>;
}

function App() {
  useEffect(connectGameAvailability, []);
  return (
    <MemoryRouter>
      <ProductAnnouncements>
        <Back />
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/games" element={<GamesPage />} />
          <Route path="/updates" element={<AnnouncementsPage />} />
        </Routes>
      </ProductAnnouncements>
    </MemoryRouter>
  );
}

afterEach(() => {
  cleanup();
  useAccount.setState(account);
  vi.restoreAllMocks();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it('waits for the tester’s access and hides the announcement and history entry when access is revoked', async () => {
  const request = useApi();
  setAccount(null);
  render(<App />);
  await act(refreshGameAvailability);
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
  expect(
    request.mock.calls.some(([url]) => url.endsWith('/v1/games/catalog'))
  ).toBe(false);

  act(() => setAccount('ordinary'));
  await act(refreshGameAvailability);
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
  act(() => setAccount('tester'));
  await screen.findByRole('heading', { name: title });
  await userEvent.click(screen.getByRole('link', { name: 'Updates' }));
  expect(screen.getByRole('heading', { name: title })).toBeVisible();
  decision = false;
  await act(refreshGameAvailability);
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
  expect(screen.getByText('No updates yet.')).toBeVisible();
});

it('does not announce Lumi when the allowed catalogue is empty or the game is in maintenance', async () => {
  const request = useApi();
  setAccount('tester');
  games = [];
  render(<App />);
  await act(refreshGameAvailability);
  await waitFor(() =>
    expect(
      request.mock.calls.some(([url]) => url.endsWith('/v1/games/catalog'))
    ).toBe(true)
  );
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
  games = fixture.map((game) => ({
    ...game,
    presentation: { ...game.presentation, availability: 'maintenance' },
  }));
  await act(async () => window.dispatchEvent(new Event('online')));
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
});

it('dismisses a release for the current account, restores focus and leaves the link in history', async () => {
  useApi();
  setAccount('tester');
  const first = render(<App />);
  const dismiss = await screen.findByRole('button', {
    name: `Dismiss announcement: ${title}`,
  });
  dismiss.focus();
  await userEvent.keyboard('{Enter}');
  expect(screen.getByRole('button', { name: 'Start day' })).toHaveFocus();
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(
    'Announcement dismissed'
  );
  first.unmount();
  render(<App />);
  await act(refreshGameAvailability);
  await userEvent.click(screen.getByRole('link', { name: 'Updates' }));
  expect(await screen.findByRole('heading', { name: title })).toBeVisible();
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
});

it('consumes the banner after successful catalogue loading, including after a failed visit', async () => {
  useApi();
  setAccount('tester');
  render(<App />);
  await screen.findByRole('heading', { name: title });
  catalogFails = true;
  await userEvent.click(
    screen.getByRole('link', { name: 'Open the games catalogue' })
  );
  await screen.findByRole('heading', { name: 'The catalogue is unavailable' });
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('heading', { name: title })).toBeVisible();
  await userEvent.click(
    screen.getByRole('link', { name: 'Open the games catalogue' })
  );
  catalogFails = false;
  await userEvent.click(await screen.findByRole('button', { name: 'Retry' }));
  await screen.findByRole('heading', { name: lumi.title });
  await userEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(
    screen.queryByRole('heading', { name: title })
  ).not.toBeInTheDocument();
});

it('supports independent announcements and falls back to tab memory when storage is unavailable', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('Blocked storage');
  });
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('Blocked storage');
  });
  setAccount('reader');
  const update = (id: string, title: string): Announcement => ({
    id,
    title: { en: title },
    description: { en: 'Try this setting in the reader.' },
    action: { en: 'Open a book' },
    placement: 'library',
    to: '/library',
  });
  const entries = [
    update('speed', 'Change playback speed'),
    update('highlight', 'Highlight a phrase'),
  ];
  const view = (
    <MemoryRouter>
      <AnnouncementContext value={entries}>
        <AnnouncementSlot placement="library" onDismiss={() => {}} />
        <AnnouncementSlot placement="today" onDismiss={() => {}} />
      </AnnouncementContext>
    </MemoryRouter>
  );
  const first = render(view);
  await userEvent.click(
    screen.getByRole('button', {
      name: 'Dismiss announcement: Change playback speed',
    })
  );
  expect(
    screen.getByRole('heading', { name: 'Highlight a phrase' })
  ).toBeVisible();
  first.unmount();
  render(view);
  expect(
    screen.queryByRole('heading', { name: 'Change playback speed' })
  ).not.toBeInTheDocument();
  act(() => setAccount('another-reader'));
  expect(
    screen.getByRole('heading', { name: 'Change playback speed' })
  ).toBeVisible();
});
