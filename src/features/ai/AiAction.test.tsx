import { act, fireEvent, render, screen } from '@testing-library/react';
import { AiAction } from './AiAction';
import { useAiStore } from './store';

vi.mock('./route', () => ({
  useAiEnabled: () => true,
  useAiUnknown: () => false,
  captureAiScope: (signal?: AbortSignal) => () => { if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); },
}));
vi.mock('./AiUpsellLink', () => ({ AiUpsellLink: () => null }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}

test('failed attempts do not consume hints; delivery consumes one', async () => {
  const onDelivered = vi.fn();
  const run = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue('Use the past tense.');
  render(<AiAction label="Hint" run={run} onDelivered={onDelivered} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  await screen.findByRole('alert');
  expect(onDelivered).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  await screen.findByText('Use the past tense.');
  expect(onDelivered).toHaveBeenCalledOnce();
});

test('cancellation blocks a late result and allows a fresh request', async () => {
  const first = deferred<string>();
  const onDelivered = vi.fn();
  const run = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue('Fresh hint');
  render(<AiAction label="Hint" run={run} onDelivered={onDelivered} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(run.mock.calls[0]?.[1]?.aborted).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  await screen.findByText('Fresh hint');
  await act(async () => first.resolve('Stale hint'));
  expect(screen.queryByText('Stale hint')).not.toBeInTheDocument();
  expect(onDelivered).toHaveBeenCalledOnce();
});

test('config change and unmount abort pending delivery', async () => {
  const first = deferred<string>();
  const onDelivered = vi.fn();
  const run = vi.fn().mockReturnValue(first.promise);
  const view = render(<AiAction label="Hint" run={run} onDelivered={onDelivered} />);
  fireEvent.click(screen.getByRole('button', { name: 'Hint' }));
  act(() => useAiStore.setState({ config: { provider: 'deepseek', model: 'deepseek-chat', apiKey: 'synthetic' } }));
  expect(run.mock.calls[0]?.[1]?.aborted).toBe(true);
  view.unmount();
  await act(async () => first.resolve('Stale'));
  expect(onDelivered).not.toHaveBeenCalled();
});
