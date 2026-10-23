import 'fake-indexeddb/auto';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import type { LoadedPack } from '@/content/loader';
import type * as SyncLocal from '@/features/sync/local';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useContentStore } from '@/content/store';
import { useSessionResults } from '@/features/progress/sessionResults';
import { CheckpointPage } from './CheckpointPage';

const { save, writeAttempt, loadAttempts } = vi.hoisted(() => ({
  save: vi.fn(async () => undefined),
  writeAttempt: vi.fn(() => new Promise(() => undefined)),
  loadAttempts: vi.fn(async () => []),
}));
vi.mock('@/features/progress/queries', () => ({ saveCheckpoint: save, loadAttempts }));
vi.mock('@/features/sync/local', async importOriginal => ({
  ...await importOriginal<typeof SyncLocal>(), addAttempt: writeAttempt,
}));

const exercise = (id: string) => ({ type: 'choice', id, instruction: { en: 'Choose.' }, tags: ['grammar.present-simple'], prompt: 'She ___ here.', options: ['works', 'work'], correctIndex: 0 });
const pack = { units: [
  { id: 'first', days: [{ id: 'first.d1', level: 'A2', sections: [{ type: 'practice', exercises: [exercise('lesson.shared')] }] }] },
  { id: 'second', days: [{ id: 'second.d1', level: 'A2', sections: [{ type: 'practice', exercises: [exercise('second.unique')] }] }] },
] } as unknown as LoadedPack;

beforeEach(() => {
  vi.clearAllMocks();
  useSessionResults.setState({ results: {} });
  useContentStore.setState({ status: 'ready', pack: { ...pack, units: pack.units.slice(0, 1) }, load: async () => undefined });
});
afterEach(cleanup);
const open = (path = '/checkpoint/first') => render(<MemoryRouter initialEntries={[path]}><Link to="/checkpoint/second">Next checkpoint</Link><Routes><Route path="/checkpoint/:unitId" element={<CheckpointPage />} /></Routes></MemoryRouter>);

test('a completed lesson does not pre-solve a checkpoint or lose its own result', async () => {
  useSessionResults.getState().record('lesson.shared', true, ['grammar.present-simple']);
  const lesson = useSessionResults.getState().results['lesson.shared'];
  open();
  const answer = await screen.findByRole('button', { name: /\d\. works$/ });
  expect(answer).toBeEnabled();
  await userEvent.click(answer);
  await userEvent.click(screen.getByRole('button', { name: 'Finish checkpoint' }));
  expect(await screen.findByText('1 / 1 on first try')).toBeInTheDocument();
  expect(useSessionResults.getState().results['lesson.shared']).toEqual(lesson);
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ score: 1, total: 1 }));
});

test('finish uses this run even before attempt persistence completes and ignores unrelated attempts', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: /\d\. works$/ }));
  act(() => useSessionResults.getState().record('unrelated', false, ['unrelated.tag']));
  await userEvent.click(screen.getByRole('button', { name: 'Finish checkpoint' }));
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ score: 1, tagBreakdown: [{ tag: 'grammar.present-simple', correct: 1, total: 1 }] }));
});

test('a corrected answer still counts its first attempt as wrong', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: /\d\. work$/ }));
  await userEvent.click(screen.getByRole('button', { name: /\d\. works$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Finish checkpoint' }));
  expect(await screen.findByText('0 / 1 on first try')).toBeInTheDocument();
});

test('re-entering the checkpoint starts a fresh run', async () => {
  const first = open();
  await userEvent.click(await screen.findByRole('button', { name: /\d\. works$/ }));
  first.unmount();
  open();
  expect(await screen.findByRole('button', { name: /\d\. works$/ })).toBeEnabled();
});

test('a data-owner change resets checkpoint answers rather than handing them to the next account', async () => {
  open();
  await userEvent.click(await screen.findByRole('button', { name: /\d\. works$/ }));
  expect(screen.getByRole('button', { name: /\d\. works$/ })).toBeDisabled();
  act(() => invalidateDataScope());
  expect(await screen.findByRole('button', { name: /\d\. works$/ })).toBeEnabled();
});

test('a level exit test has the same isolation from completed lessons', async () => {
  useSessionResults.getState().record('lesson.shared', true, ['grammar.present-simple']);
  open('/checkpoint/exit-A2');
  await userEvent.click(await screen.findByRole('button', { name: /\d\. works$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Finish test' }));
  expect(await screen.findByText('1 / 1 on first try')).toBeInTheDocument();
  expect(save).toHaveBeenCalledWith(expect.objectContaining({ unitId: 'exit-A2', score: 1, total: 1 }));
});

test('changing the checkpoint route clears the previous result and exercise pool', async () => {
  useContentStore.setState({ pack });
  open();
  await userEvent.click(await screen.findByRole('button', { name: /\d\. works$/ }));
  await userEvent.click(screen.getByRole('button', { name: 'Finish checkpoint' }));
  expect(await screen.findByText('1 / 1 on first try')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('link', { name: 'Next checkpoint' }));
  expect(await screen.findByRole('heading', { name: 'Unit checkpoint' })).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /\d\. works$/ })).toHaveLength(2);
  expect(screen.getAllByRole('button', { name: /\d\. works$/ }).every(b => !b.hasAttribute('disabled'))).toBe(true);
});
