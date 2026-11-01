import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useFeedbackDraft } from '@/features/feedback/draft';
import { installDialogMock } from '@/test/dialog';
import { FeedbackPage } from './FeedbackPage';

vi.mock('@/features/feedback/config', () => ({
  FEEDBACK_ENDPOINT: '',
  WEB3FORMS_ACCESS_KEY: 'test-public-key',
  FEEDBACK_EMAIL: '',
}));
const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/feedback']}>
      <FeedbackPage />
    </MemoryRouter>
  );
const message = 'I cannot hear audio in lesson A2.';
const send = () => screen.getByRole('button', { name: 'Send message' });
const text = () => screen.getByRole('textbox', { name: /Tell us more/ });
async function fill() {
  await userEvent.click(
    screen.getByRole('radio', { name: 'Something’s broken' })
  );
  await userEvent.type(text(), message);
}
function deferred() {
  let resolve!: (value: Response) => void;
  const promise = new Promise<Response>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(async () => {
  vi.restoreAllMocks();
  installDialogMock();
  invalidateDataScope();
  await db.open();
  await db.feedbackOutbox.clear();
  Object.defineProperty(navigator, 'onLine', {
    value: true,
    configurable: true,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(async () => new Response('{"success":true}'))
  );
});
afterEach(() => vi.unstubAllGlobals());

test('uses the approved page structure and real navigation without prototype controls', async () => {
  renderPage();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
    'Let’s make DayEnglish better'
  );
  expect(screen.getByRole('link', { name: 'About' })).toHaveAttribute(
    'href',
    '/about'
  );
  expect(screen.getByRole('link', { name: 'Privacy' })).toHaveAttribute(
    'href',
    '/privacy'
  );
  expect(
    screen.queryByText(/interactive example|nothing personal|simulation/i)
  ).toBeNull();
  expect(screen.getByRole('button', { name: 'Clear' })).toBeDisabled();
  await userEvent.click(screen.getByText('What is sent with your message'));
  expect(screen.getByText(/Do not include passwords/)).toBeInTheDocument();
  expect(screen.getByText('/feedback')).toBeInTheDocument();
});

test('submitting an empty form focuses an error summary with links to the invalid controls', async () => {
  renderPage();
  await userEvent.click(send());
  const summary = screen.getByRole('alert');
  await waitFor(() => expect(summary).toHaveFocus());
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.click(
    within(summary).getByRole('link', { name: 'Choose a topic.' })
  );
  expect(
    screen.getByRole('radio', { name: 'Something’s broken' })
  ).toHaveFocus();
});

test('switching categories preserves both fields and changes the useful prompt', async () => {
  renderPage();
  await fill();
  const email = screen.getByRole('textbox', { name: /Reply email/ });
  await userEvent.type(email, 'reader@example.com');
  await userEvent.click(screen.getByRole('radio', { name: 'I have an idea' }));
  expect(text()).toHaveValue(message);
  expect(email).toHaveValue('reader@example.com');
  expect(text()).toHaveAttribute(
    'placeholder',
    'For example: I want to find words saved from my book more easily.'
  );
});

test('validates an optional email and allows deliberately omitting it', async () => {
  renderPage();
  await fill();
  const email = screen.getByRole('textbox', { name: /Reply email/ });
  await userEvent.type(email, 'not-an-email');
  await userEvent.click(send());
  expect(email).toHaveAttribute('aria-invalid', 'true');
  expect(fetch).not.toHaveBeenCalled();
  await userEvent.clear(email);
  await userEvent.click(send());
  expect(
    await screen.findByRole('heading', { name: 'Thank you, message sent!' })
  ).toBeInTheDocument();
  expect(screen.getByText('No reply email provided.')).toBeInTheDocument();
});

test('failed persistence keeps the draft and never claims success or a saved queue', async () => {
  renderPage();
  await fill();
  vi.spyOn(db.feedbackOutbox, 'add').mockRejectedValueOnce(new Error('Quota'));
  await userEvent.click(send());
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'could not be saved'
  );
  expect(text()).toHaveValue(message);
  expect(send()).toBeEnabled();
  expect(screen.queryByRole('heading', { name: 'Message saved' })).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

test('double submit is locked, cancellation preserves one row, and retry sends that same snapshot', async () => {
  const request = deferred();
  vi.mocked(fetch).mockReturnValue(request.promise);
  renderPage();
  await fill();
  const form = send().closest('form')!;
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  expect(text()).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: 'Stop attempt' }));
  expect(
    await screen.findByRole('heading', { name: 'Message saved' })
  ).toBeInTheDocument();
  expect(await db.feedbackOutbox.count()).toBe(1);
  const initial = (await db.feedbackOutbox.toArray())[0]!;
  request.resolve(new Response('{"success":true}'));
  vi.mocked(fetch).mockResolvedValue(new Response('{"success":true}'));
  await userEvent.click(screen.getByRole('button', { name: 'Retry delivery' }));
  expect(
    await screen.findByRole('heading', { name: 'Thank you, message sent!' })
  ).toBeInTheDocument();
  expect(await db.feedbackOutbox.count()).toBe(0);
  expect(vi.mocked(fetch).mock.calls[1]?.[1]?.body).toBe(
    vi.mocked(fetch).mock.calls[0]?.[1]?.body
  );
  expect(screen.getByText(message)).toBeInTheDocument();
  expect(useFeedbackDraft.getState().receipt?.item.submissionId).toBe(
    initial.submissionId
  );
});

test('offline messages survive component reload and a new draft survives viewing one', async () => {
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });
  const first = renderPage();
  await fill();
  await userEvent.click(send());
  await screen.findByRole('heading', { name: 'Message saved' });
  first.unmount();
  act(() => useFeedbackDraft.getState().reset());
  renderPage();
  await userEvent.type(text(), 'An unsubmitted draft to preserve.');
  await userEvent.click(
    await screen.findByRole('button', { name: 'View message' })
  );
  expect(screen.getByText(message)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Back to draft' }));
  expect(text()).toHaveValue('An unsubmitted draft to preserve.');
  expect(await db.feedbackOutbox.count()).toBe(1);
  expect(fetch).not.toHaveBeenCalled();
});

test('clear asks for confirmation; Escape retains the draft and confirmation clears it', async () => {
  renderPage();
  await fill();
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { bubbles: true, cancelable: true })
  );
  expect(text()).toHaveValue(message);
  await userEvent.click(screen.getByRole('button', { name: 'Clear' }));
  await userEvent.click(
    within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear' })
  );
  expect(text()).toHaveValue('');
  expect(
    screen.getByRole('radio', { name: 'Something’s broken' })
  ).not.toBeChecked();
});

test('a new message starts blank and uses a new delivery identity', async () => {
  renderPage();
  await fill();
  const id = useFeedbackDraft.getState().draft.submissionId;
  await userEvent.click(send());
  await screen.findByRole('heading', { name: 'Thank you, message sent!' });
  await userEvent.click(screen.getByRole('button', { name: 'New message' }));
  expect(text()).toHaveValue('');
  expect(useFeedbackDraft.getState().draft.submissionId).not.toBe(id);
});

test('leaving a mounted page interrupts transport but preserves the saved receipt and never loses the draft', async () => {
  const request = deferred();
  vi.mocked(fetch).mockReturnValue(request.promise);
  const view = renderPage();
  await fill();
  await userEvent.click(send());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  view.unmount();
  await waitFor(() =>
    expect(useFeedbackDraft.getState().receipt?.status).toBe('queued')
  );
  expect(await db.feedbackOutbox.count()).toBe(1);
  renderPage();
  expect(
    screen.getByRole('heading', { name: 'Message saved' })
  ).toBeInTheDocument();
});

test('completion does not take focus from navigation or another open dialog', async () => {
  const request = deferred();
  vi.mocked(fetch).mockReturnValue(request.promise);
  renderPage();
  await fill();
  await userEvent.click(send());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  const elsewhere = screen.getByRole('link', { name: 'About' });
  elsewhere.focus();
  await act(async () => request.resolve(new Response('{"success":true}')));
  await screen.findByRole('heading', { name: 'Thank you, message sent!' });
  expect(elsewhere).toHaveFocus();
});

test('changing device owner clears the draft and rejects late results', async () => {
  const request = deferred();
  vi.mocked(fetch).mockReturnValue(request.promise);
  renderPage();
  await fill();
  await userEvent.click(send());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  await act(async () => {
    invalidateDataScope();
    await db.feedbackOutbox.clear();
    request.resolve(new Response('{"success":true}'));
  });
  await waitFor(() => expect(send()).toBeEnabled());
  expect(text()).toHaveValue('');
  expect(useFeedbackDraft.getState().receipt).toBeNull();
});

test('a late cancellation cannot replace a draft edited after returning to the page', async () => {
  const request = deferred();
  vi.mocked(fetch).mockReturnValue(request.promise);
  const first = renderPage();
  await fill();
  await userEvent.click(send());
  await waitFor(() => expect(fetch).toHaveBeenCalledOnce());
  first.unmount();
  act(() =>
    useFeedbackDraft
      .getState()
      .edit({ text: 'An edited draft after navigation.' })
  );
  renderPage();
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'View message' })
    ).toBeInTheDocument()
  );
  expect(text()).toHaveValue('An edited draft after navigation.');
  expect(useFeedbackDraft.getState().receipt).toBeNull();
});

test('diagnostics capture the actual connection at submit rather than the last render', async () => {
  renderPage();
  await fill();
  Object.defineProperty(navigator, 'onLine', {
    value: false,
    configurable: true,
  });
  await userEvent.click(send());
  await screen.findByRole('heading', { name: 'Message saved' });
  expect(useFeedbackDraft.getState().receipt?.item.body.online_at_submit).toBe(
    false
  );
  expect(fetch).not.toHaveBeenCalled();
});

test('queue read failures are explicit and can recover instead of pretending it is empty', async () => {
  const read = vi
    .spyOn(db.feedbackOutbox, 'orderBy')
    .mockImplementationOnce(() => {
      throw new Error('Read failed');
    });
  renderPage();
  const retry = await screen.findByRole('button', { name: 'Check again' });
  expect(
    screen.getByText('Saved messages could not be read.')
  ).toBeInTheDocument();
  read.mockRestore();
  await userEvent.click(retry);
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull()
  );
});
