import 'fake-indexeddb/auto';
import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { isNativePlatform } from '@/shared/lib/platform';
import { GameCard, GameDetails } from './GameCatalog';
import { GameManifestSchema } from './contract';
import { gameScope, writeSave } from './storage';
import lumi from '../../../examples/lumi-catalog.json';

vi.mock('@/shared/lib/platform', () => ({
  isNativePlatform: vi.fn(() => false),
}));
const game = GameManifestSchema.parse(lumi[0]);
beforeEach(async () => {
  await db.gameRecords.clear();
  vi.mocked(isNativePlatform).mockReturnValue(false);
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
it('offers continuation only after an actual local checkpoint is written', async () => {
  render(
    <StrictMode>
      <MemoryRouter>
        <GameCard game={game} />
      </MemoryRouter>
    </StrictMode>
  );
  await screen.findByRole('link', { name: /Start game/ }, { timeout: 5000 });
  expect(screen.queryByText(/A save is available/)).not.toBeInTheDocument();
  await writeSave(gameScope(), game.gameId, {
    slotId: '0',
    baseRevision: 0,
    operationId: crypto.randomUUID(),
    schemaVersion: 1,
    payload: { step: 2 },
  });
  await screen.findByRole('link', { name: /Continue game/ });
  expect(
    screen.getByText(/Changes have not been uploaded/)
  ).toBeInTheDocument();
});
it('keeps maintenance games visible without a launch action', () => {
  render(
    <MemoryRouter>
      <GameCard
        game={{
          ...game,
          presentation: { ...game.presentation!, availability: 'maintenance' },
        }}
      />
    </MemoryRouter>
  );
  expect(screen.getByRole('status')).toHaveTextContent(
    'Temporarily unavailable'
  );
  expect(
    screen
      .getAllByRole('link')
      .some((link) => link.getAttribute('href') === `/games/${game.gameId}`)
  ).toBe(false);
});
it('uses a website handoff on Android instead of embedding a third-party game', () => {
  vi.mocked(isNativePlatform).mockReturnValue(true);
  render(
    <MemoryRouter>
      <GameCard game={game} />
    </MemoryRouter>
  );
  expect(screen.getByRole('link', { name: /Open website/ })).toHaveAttribute(
    'href',
    `https://dayenglish.ru/games/${game.gameId}`
  );
  expect(
    screen.getByText(/This game release is available on the website/)
  ).toBeInTheDocument();
});
it('shows an honest empty save state and guest cloud requirements in StrictMode', async () => {
  render(
    <StrictMode>
      <MemoryRouter>
        <GameDetails game={game} />
      </MemoryRouter>
    </StrictMode>
  );
  fireEvent.click(screen.getByRole('button', { name: 'My saves' }));
  await waitFor(() =>
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'The game has not saved a checkpoint yet.'
    )
  );
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute(
    'href',
    '/account/login'
  );
  expect(
    screen.queryByRole('button', { name: 'Upload to cloud' })
  ).not.toBeInTheDocument();
});
