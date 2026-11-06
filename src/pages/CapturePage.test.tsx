import 'fake-indexeddb/auto';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { RecoveryNavigationGuard } from '@/features/account/RecoveryNavigationGuard';
import { createVocabularyEntry } from '@/features/vocab/vocabulary-mutations';
import { captureLink } from '@/features/capture/links';
import * as service from '@/features/capture/service';
import { CapturePage } from './CapturePage';
import { installDialogMock } from '@/test/dialog';

vi.mock('@/features/analytics/analytics', () => ({ track: vi.fn() }));
vi.mock('@/features/sync/run', () => ({ nudgeSync: vi.fn() }));
const payload = {
  term: 'It depends',
  translation: 'Зависит от ситуации',
  context: 'It depends on the weather.',
  source: 'telegram' as const,
};
const routers: ReturnType<typeof createMemoryRouter>[] = [];
function open(query = new URL(captureLink(payload)).search) {
  const router = createMemoryRouter(
    [
      {
        element: (
          <RecoveryNavigationGuard>
            <Outlet />
          </RecoveryNavigationGuard>
        ),
        children: [
          { path: '/capture', element: <CapturePage /> },
          { path: '/vocabulary/entry/:id', element: <h1>Vocabulary entry</h1> },
          { path: '/', element: <h1>Home</h1> },
        ],
      },
    ],
    { initialEntries: ['/capture' + query] }
  );
  render(<RouterProvider router={router} />);
  routers.push(router);
  return router;
}
async function ready() {
  await waitFor(() =>
    expect(
      screen.queryByText('Checking your vocabulary…')
    ).not.toBeInTheDocument()
  );
}
beforeEach(async () => {
  vi.restoreAllMocks();
  invalidateDataScope();
  installDialogMock();
  const NativeRequest = globalThis.Request;
  vi.stubGlobal(
    'Request',
    class extends NativeRequest {
      constructor(input: RequestInfo | URL, init?: RequestInit) {
        super(input, { ...init, signal: undefined });
      }
    }
  );
  await db.open();
  for (const table of [
    db.srsCards,
    db.wordStatus,
    db.translations,
    db.pending,
    db.activity,
    db.reviewLog,
  ])
    await table.clear();
});
afterEach(() => {
  cleanup();
  routers.splice(0).forEach((router) => router.dispose());
  vi.unstubAllGlobals();
});
test('an incoming phrase is editable and saves only after confirmation; preview does not grade it', async () => {
  const router = open();
  await ready();
  expect(await db.srsCards.count()).toBe(0);
  fireEvent.change(screen.getByLabelText('Translation for your card'), {
    target: { value: 'Мой вариант' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await screen.findByRole('status', { name: '' });
  await screen.findByText('The phrase is in your vocabulary');
  const before = await db.srsCards.get('phrase:it depends');
  expect(before?.back).toBe('Мой вариант');
  fireEvent.click(screen.getByRole('button', { name: 'Preview card' }));
  fireEvent.click(screen.getByRole('button', { name: 'Show translation' }));
  expect(await db.srsCards.get('phrase:it depends')).toEqual(before);
  expect(await db.reviewLog.count()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Open in vocabulary' }));
  await screen.findByText('Vocabulary entry');
  expect(router.state.location.state).toEqual({ fromCapture: true });
});
test('unchanged cancellation needs no dialog and preserves a return path', async () => {
  open();
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
  expect(screen.getByText('Nothing added')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(await db.srsCards.count()).toBe(0);
  fireEvent.click(screen.getByRole('button', { name: 'Return to phrase' }));
  expect(screen.getByLabelText('English phrase')).toHaveValue('It depends');
});
test('correcting validation clears the error styling and accessible invalid state', async () => {
  open();
  await ready();
  const input = screen.getByLabelText('Translation for your card');
  fireEvent.change(input, { target: { value: '' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  expect(input).toHaveAttribute('aria-invalid', 'true');
  fireEvent.change(input, { target: { value: 'Исправлено' } });
  expect(input).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
test('dictionary-only save creates no scheduled card', async () => {
  open();
  await ready();
  fireEvent.click(screen.getByRole('checkbox', { name: /Include in review/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Save to vocabulary' }));
  await screen.findByText('The phrase is in your vocabulary');
  expect(await db.srsCards.count()).toBe(0);
  expect((await db.wordStatus.get('it depends'))?.status).toBe('learning');
});

test('an oversized hidden example opens for correction instead of leaving focus outside', async () => {
  open(new URL(captureLink({ ...payload, context: 'a'.repeat(1001) })).search);
  await ready();
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  const field = screen.getByLabelText('Example (optional)');
  await waitFor(() => expect(field).toHaveFocus());
  expect(field.closest('details')).toHaveAttribute('open');
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(await db.srsCards.count()).toBe(0);
});
test('duplicate starts with the owned meaning; editing requires an explicit separate confirmation', async () => {
  await createVocabularyEntry('It depends', 'Старый собственный перевод', '');
  const before = await db.srsCards.get('phrase:it depends');
  open();
  await ready();
  expect(screen.getByText('Старый собственный перевод')).toBeInTheDocument();
  expect(
    screen.getByText('Other actions').closest('details')
  ).not.toHaveAttribute('open');
  expect(
    screen.getByRole('button', { name: 'Update my translation' })
  ).not.toBeVisible();
  fireEvent.click(screen.getByText('Other actions'));
  fireEvent.click(
    screen.getByRole('button', { name: 'Update my translation' })
  );
  expect(await db.srsCards.get('phrase:it depends')).toEqual(before);
  fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
  await screen.findByText('The phrase is in your vocabulary');
  const after = await db.srsCards.get('phrase:it depends');
  expect(after?.back).toBe(payload.translation);
  expect(after?.card).toEqual(before?.card);
});
test('a warm incoming link cannot silently replace an edited draft', async () => {
  const router = open();
  await ready();
  fireEvent.change(screen.getByLabelText('Translation for your card'), {
    target: { value: 'Не терять' },
  });
  await act(async () => {
    await router.navigate('/capture?v=1&en=New&ru=Новое');
  });
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  expect(screen.getByLabelText('Translation for your card')).toHaveValue(
    'Не терять'
  );
  fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
  expect(screen.getByLabelText('Translation for your card')).toHaveValue(
    'Не терять'
  );
  expect(await db.srsCards.count()).toBe(0);
});
test('invalid input never displays the demo phrase; storage failure can be checked without new writes', async () => {
  open('?v=1&ru=перевод');
  await ready();
  expect(screen.getByLabelText('English phrase')).toHaveValue('');
  fireEvent.change(screen.getByLabelText('English phrase'), {
    target: { value: payload.term },
  });
  fireEvent.change(screen.getByLabelText('Translation for your card'), {
    target: { value: payload.translation },
  });
  await ready();
  vi.spyOn(service, 'saveCapturedPhrase').mockRejectedValueOnce(
    new Error('storage')
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save and review' }));
  await screen.findByRole('alert');
  expect(screen.getByLabelText('Translation for your card')).toHaveValue(
    payload.translation
  );
  fireEvent.click(screen.getByRole('button', { name: 'Check result' }));
  await ready();
  expect(await db.srsCards.count()).toBe(0);
});
