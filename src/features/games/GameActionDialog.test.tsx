import { StrictMode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { GameActionDialog } from './GameActionDialog';
import { translateReaderResult } from '@/features/reader/translate';
import {
  readCapturedPhrase,
  saveCapturedPhrase,
} from '@/features/capture/service';

vi.mock('@/features/capture/service', () => ({
  readCapturedPhrase: vi.fn(async () => ({
    key: 'it depends',
    state: 'new',
    translation: '',
  })),
  saveCapturedPhrase: vi.fn(async () => ({ changed: true })),
}));
vi.mock('@/features/ai/route', () => ({ aiAvailable: () => false }));
vi.mock('@/features/reader/translate', () => ({
  translateReaderResult: vi.fn(),
}));

it('can save after the StrictMode effect cleanup and setup cycle', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  const finish = vi.fn();
  render(
    <StrictMode>
      <MemoryRouter>
        <GameActionDialog
          prompt={{
            kind: 'capture',
            data: { term: 'It depends', translation: 'Зависит', context: '' },
            scope: { owner: 'guest', check() {} },
            signal: new AbortController().signal,
            finish,
          }}
        />
      </MemoryRouter>
    </StrictMode>
  );
  fireEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  await waitFor(() => expect(finish).toHaveBeenCalledWith({ status: 'saved' }));
  expect(readCapturedPhrase).toHaveBeenCalledOnce();
  expect(saveCapturedPhrase).toHaveBeenCalledOnce();
});

it('translates only after confirmation and returns text only on Return to game', async () => {
  vi.mocked(translateReaderResult).mockResolvedValue({
    text: 'Это зависит от погоды.',
    source: 'free',
    contextual: false,
  });
  const finish = vi.fn();
  render(
    <MemoryRouter>
      <GameActionDialog
        prompt={{
          kind: 'translation',
          data: { text: 'It depends on the weather.', context: '' },
          scope: { owner: 'guest', check() {} },
          signal: new AbortController().signal,
          finish,
        }}
      />
    </MemoryRouter>
  );
  expect(translateReaderResult).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Translate$/ }));
  expect(await screen.findByText('Это зависит от погоды.')).toBeInTheDocument();
  expect(translateReaderResult).toHaveBeenCalledWith(
    'It depends on the weather.',
    expect.objectContaining({ ai: false })
  );
  expect(finish).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Return to game' }));
  expect(finish).toHaveBeenCalledWith({
    status: 'translated',
    text: 'Это зависит от погоды.',
  });
});
