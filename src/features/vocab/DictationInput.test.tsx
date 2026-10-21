import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
import { DictationInput } from './DictationInput';
import { installDictation, probeDictation, startDictation } from './dictation';
import { DictationError } from './dictation-types';
import type { DictationUpdate } from './dictation-types';
vi.mock('./dictation', () => ({ probeDictation: vi.fn(), installDictation: vi.fn(), startDictation: vi.fn() }));
let finish: (text: string) => void, emit: (value: DictationUpdate) => void;
const cancel = vi.fn(), stop = vi.fn();
beforeEach(() => {
  vi.mocked(probeDictation).mockReset().mockResolvedValue({ local: 'ready', system: true, install: true, native: false });
  vi.mocked(installDictation).mockReset().mockResolvedValue(); cancel.mockClear(); stop.mockClear();
  vi.mocked(startDictation).mockReset().mockImplementation((_mode, update) => {
    emit = update; return { result: new Promise(resolve => { finish = resolve; }), cancel, stop };
  });
});
afterEach(cleanup);
async function open(draft = 'Old field.', props: { separator?: string; limit?: number } = {}) {
  const onAccept = vi.fn(); const view = render(<DictationInput draft={draft} onAccept={onAccept} {...props} />);
  await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled());
  return { ...view, onAccept };
}
test('opening panel only checks capability; explicit recording/final/edit/apply preserves draft and requires consent for system', async () => {
  const { onAccept } = await open('Old field.', { separator: '\n\n', limit: 2000 });
  expect(startDictation).not.toHaveBeenCalled(); expect(installDictation).not.toHaveBeenCalled();
  await userEvent.selectOptions(screen.getByLabelText('Recognition mode'), 'system');
  expect(screen.getByText(/Audio may be sent/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Start' })); expect(startDictation).toHaveBeenCalledWith('system', expect.anything());
  act(() => emit({ phase: 'listening', preview: 'A guessed word' })); expect(screen.queryByLabelText('Check dictated text')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Stop' })); expect(stop).toHaveBeenCalledOnce();
  await act(async () => finish('Take care.')); expect(onAccept).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Check dictated text')).toHaveFocus();
  fireEvent.change(screen.getByLabelText('Check dictated text'), { target: { value: 'Take care near the bank.' } });
  await userEvent.click(screen.getByRole('button', { name: 'Append to text' })); expect(onAccept).toHaveBeenCalledWith('Old field.\n\nTake care near the bank.');
});
test.each(['cancel', 'close', 'escape', 'mode', 'owner', 'background', 'unmount'])('%s invalidates pending recognition and ignores late text', async action => {
  const { onAccept, unmount } = await open(); await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  if (action === 'cancel') await userEvent.click(screen.getByRole('button', { name: 'Cancel recording' }));
  if (action === 'close') await userEvent.click(screen.getByRole('button', { name: 'Close dictation' }));
  if (action === 'escape') await userEvent.keyboard('{Escape}');
  if (action === 'mode') await userEvent.selectOptions(screen.getByLabelText('Recognition mode'), 'system');
  if (action === 'owner') act(invalidateDataScope);
  if (action === 'background') act(() => window.dispatchEvent(new Event('pagehide')));
  if (action === 'unmount') unmount();
  expect(cancel).toHaveBeenCalled(); await act(async () => finish('Old private transcript'));
  expect(screen.queryByLabelText('Check dictated text')).toBeNull(); expect(onAccept).not.toHaveBeenCalled();
});
test('local unavailable stays local until explicitly selected; no automatic installation or activation on recheck', async () => {
  vi.mocked(probeDictation).mockResolvedValue({ local: 'downloadable', system: true, install: true, native: false });
  render(<DictationInput draft="" onAccept={vi.fn()} />); await userEvent.click(screen.getByRole('button', { name: 'Dictate in English' }));
  const download = await screen.findByRole('button', { name: 'Download English model' }); expect(screen.getByRole('button', { name: 'Start' })).toBeDisabled();
  await userEvent.click(download); await screen.findByText(/browser owns this download/);
  expect(installDictation).toHaveBeenCalledOnce(); expect(startDictation).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Recheck' })); expect(startDictation).not.toHaveBeenCalled();
});
test('denied mic leaves field untouched, overlimit stays editable and empty candidate cannot apply', async () => {
  vi.mocked(startDictation).mockImplementationOnce(() => ({ result: Promise.reject(new DictationError('permission')), cancel, stop }));
  const { onAccept } = await open('', { limit: 10 }); await userEvent.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByText(/Microphone access denied/); expect(onAccept).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Start' })); await act(async () => finish('a'.repeat(11)));
  expect(screen.getByLabelText('Check dictated text')).toHaveValue('a'.repeat(11)); expect(screen.getByRole('button', { name: 'Use text' })).toBeDisabled();
  fireEvent.change(screen.getByLabelText('Check dictated text'), { target: { value: '' } }); expect(screen.getByRole('button', { name: 'Use text' })).toBeDisabled();
});
