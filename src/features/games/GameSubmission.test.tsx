import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { submitFeedback } from '@/features/feedback/service';
import type { SubmitResult } from '@/features/feedback/service';
import { GameSubmission } from './GameSubmission';
import { RecoveryNavigationGuard } from '@/features/account/RecoveryNavigationGuard';

vi.mock('@/features/feedback/service', () => ({
  submitFeedback: vi.fn(),
  collectContext: () => ({ page: '/games/submit' }),
}));
beforeEach(() => {
  vi.mocked(submitFeedback).mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
function setup() {
  const router = createMemoryRouter(
    [
      {
        path: '/games/submit',
        element: (
          <RecoveryNavigationGuard>
            <GameSubmission />
          </RecoveryNavigationGuard>
        ),
      },
      { path: '/games', element: <p>Catalogue</p> },
    ],
    { initialEntries: ['/games/submit'] }
  );
  render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>
  );
  fireEvent.change(screen.getByLabelText('Game title'), {
    target: { value: 'QA sample' },
  });
  fireEvent.change(screen.getByLabelText('Game or walkthrough URL'), {
    target: { value: 'https://example.invalid/demo' },
  });
  fireEvent.change(
    screen.getByLabelText('How does the game help people learn English?'),
    { target: { value: 'Practise articles.' } }
  );
  fireEvent.change(screen.getByLabelText('Reply email'), {
    target: { value: 'qa@example.invalid' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  return router;
}
it('previews and edits without sending, then distinguishes offline queue from delivery', async () => {
  setup();
  fireEvent.click(screen.getByRole('button', { name: /Review submission/ }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Practise articles.');
  expect(submitFeedback).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Edit submission' }));
  expect(screen.getByLabelText('Game title')).toHaveValue('QA sample');
  vi.mocked(submitFeedback).mockResolvedValue({
    status: 'queued',
  } as SubmitResult);
  fireEvent.click(screen.getByRole('button', { name: /Review submission/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }));
  expect(
    await screen.findByRole('heading', {
      name: 'Submission saved on this device',
    })
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Delivery has not been confirmed/)
  ).toBeInTheDocument();
  expect(submitFeedback).toHaveBeenCalledOnce();
});
it('rejects credential URLs and preserves the draft when navigation is cancelled', async () => {
  setup();
  fireEvent.change(screen.getByLabelText('Game or walkthrough URL'), {
    target: { value: 'https://user:password@example.invalid' },
  });
  fireEvent.click(screen.getByRole('button', { name: /Review submission/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('without credentials');
  fireEvent.click(screen.getByRole('link', { name: /All games/ }));
  await screen.findByRole('dialog');
  fireEvent.click(screen.getByRole('button', { name: 'Stay' }));
  expect(screen.getByLabelText('Game title')).toHaveValue('QA sample');
  expect(submitFeedback).not.toHaveBeenCalled();
});
it('keeps the draft after a storage failure and prevents concurrent submissions', async () => {
  setup();
  let reject: (e: Error) => void = () => {};
  vi.mocked(submitFeedback).mockImplementation(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      })
  );
  fireEvent.click(screen.getByRole('button', { name: /Review submission/ }));
  const send = screen.getByRole('button', { name: 'Submit for review' });
  fireEvent.click(send);
  fireEvent.click(send);
  expect(submitFeedback).toHaveBeenCalledOnce();
  reject(new Error('storage unavailable'));
  expect(await screen.findAllByRole('alert')).not.toHaveLength(0);
  fireEvent.click(screen.getByRole('button', { name: 'Edit submission' }));
  expect(screen.getByLabelText('Game title')).toHaveValue('QA sample');
});
