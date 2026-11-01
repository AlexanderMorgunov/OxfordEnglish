import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { VocabularyExample } from './VocabularyExample';
import { requestWordSenses } from './word-senses';
import { AI_REQUEST_TIMEOUT } from '@/features/ai/route';
import { invalidateDataScope } from '@/features/account/dataScope';

const access = vi.hoisted(() => ({ enabled: true, unknown: false }));
vi.mock('@/features/ai/route', async (original) => ({
  ...(await original<object>()),
  useAiEnabled: () => access.enabled,
  useAiUnknown: () => access.unknown,
}));
vi.mock('./word-senses', () => ({ requestWordSenses: vi.fn() }));
const result = {
  path: 'managed' as const,
  cached: false,
  senses: [
    {
      partOfSpeech: 'adjective' as const,
      translation: 'хороший',
      distinction: 'Оценка качества',
      example: 'This is a good idea.',
    },
  ],
};
beforeEach(() => {
  access.enabled = true;
  access.unknown = false;
  vi.restoreAllMocks();
  vi.mocked(requestWordSenses).mockReset().mockResolvedValue(result);
});
const base = () => ({
  term: 'good',
  revision: 0,
  disabled: false,
  onApply: vi.fn(),
  onBusyChange: vi.fn(),
});

test('free or unreadable access never sends a new AI example request', async () => {
  access.enabled = false;
  const props = base(),
    view = render(<VocabularyExample {...props} />, { wrapper: MemoryRouter });
  expect(
    screen.getByRole('button', { name: 'Create example · AI' })
  ).toBeDisabled();
  expect(screen.getByRole('link', { name: 'DayEnglish Pro' })).toHaveAttribute(
    'href',
    '/pro'
  );
  access.enabled = true;
  access.unknown = true;
  view.rerender(<VocabularyExample {...props} />);
  expect(
    screen.getByRole('button', { name: 'Create example · AI' })
  ).toBeDisabled();
  expect(requestWordSenses).not.toHaveBeenCalled();
});

test('request and example selection are explicit, and do not change the Russian answer', async () => {
  const props = base();
  render(<VocabularyExample {...props} />, { wrapper: MemoryRouter });
  expect(requestWordSenses).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  await screen.findByRole('button', { name: 'Use example 1' });
  expect(props.onApply).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Use example 1' }));
  expect(props.onApply).toHaveBeenCalledExactlyOnceWith(result.senses[0]);
});

test.each(['term', 'revision', 'disabled', 'access', 'unmount'] as const)(
  'late example is ignored after %s changes',
  async (action) => {
    let finish!: (value: typeof result) => void;
    vi.mocked(requestWordSenses).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        })
    );
    const props = base(),
      view = render(<VocabularyExample {...props} />, {
        wrapper: MemoryRouter,
      });
    const button = screen.getByRole('button', { name: 'Create example · AI' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(requestWordSenses).toHaveBeenCalledOnce();
    const signal = vi.mocked(requestWordSenses).mock.calls[0]![2];
    if (action === 'unmount') view.unmount();
    else {
      if (action === 'access') access.enabled = false;
      view.rerender(
        <VocabularyExample
          {...props}
          {...(action === 'term'
            ? { term: 'other' }
            : action === 'revision'
              ? { revision: 1 }
              : action === 'disabled'
                ? { disabled: true }
                : {})}
        />
      );
    }
    expect(signal.aborted).toBe(true);
    await act(async () => finish(result));
    expect(props.onApply).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Use example 1' })).toBeNull();
  }
);

test('failed example restores a reachable retry control and never applies an answer', async () => {
  vi.mocked(requestWordSenses).mockRejectedValueOnce(new Error('Unavailable'));
  const props = base();
  render(<VocabularyExample {...props} />, { wrapper: MemoryRouter });
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not get an example'
  );
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Create example · AI' })
    ).toHaveFocus()
  );
  expect(props.onApply).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  expect(
    await screen.findByRole('button', { name: 'Use example 1' })
  ).toBeVisible();
});

test('deadline aborts a stalled example and ignores its result after a successful retry', async () => {
  let finish!: (value: typeof result) => void;
  vi.mocked(requestWordSenses).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  const props = base();
  render(<VocabularyExample {...props} />, { wrapper: MemoryRouter });
  const timers = vi.spyOn(globalThis, 'setTimeout');
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  const deadline = timers.mock.calls.find(
    ([, delay]) => delay === AI_REQUEST_TIMEOUT + 2000
  )?.[0];
  if (typeof deadline !== 'function') throw new Error('No deadline');
  act(() => deadline());
  expect(await screen.findByRole('alert')).toHaveTextContent('timed out');
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  await screen.findByRole('button', { name: 'Use example 1' });
  await act(async () => finish({ ...result, senses: [] }));
  expect(screen.getByRole('button', { name: 'Use example 1' })).toBeVisible();
  expect(props.onApply).not.toHaveBeenCalled();
});

test('a visible example proposal cannot be applied after its data owner changes', async () => {
  const props = base();
  render(<VocabularyExample {...props} />, { wrapper: MemoryRouter });
  await userEvent.click(
    screen.getByRole('button', { name: 'Create example · AI' })
  );
  await screen.findByRole('button', { name: 'Use example 1' });
  act(() => invalidateDataScope());
  await userEvent.click(screen.getByRole('button', { name: 'Use example 1' }));
  expect(props.onApply).not.toHaveBeenCalled();
});
