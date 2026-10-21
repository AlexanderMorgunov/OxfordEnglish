import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import type * as ContentLoader from '@/content/loader';

type LoadedPack = ContentLoader.LoadedPack;

const loadPublicPack = vi.fn<() => Promise<LoadedPack>>();
vi.mock('@/content/loader', async (importOriginal) => ({
  ...await importOriginal<typeof ContentLoader>(),
  loadPublicPack: () => loadPublicPack(),
}));
vi.mock('@/features/progress/queries', () => ({
  loadAttempts: async () => [], vocabSize: async () => 7,
  checkpointHistory: async () => [], saveCheckpoint: async () => undefined,
}));
vi.mock('@/features/stats/ReadingStats', () => ({ ReadingStats: () => <p>Local reading history</p> }));

const { useContentStore } = await import('@/content/store');
const { DashboardPage } = await import('./DashboardPage');
const { DayPage } = await import('./DayPage');
const { CheckpointPage } = await import('./CheckpointPage');
const { PlacementPage } = await import('./PlacementPage');
const { ProgressPage } = await import('./ProgressPage');

const title = { en: 'A recovered lesson', ru: 'Загруженный урок' };
const day = {
  id: 'unit.d1', title, estimatedMinutes: 5, tags: [],
  sections: [{ type: 'vocabulary' as const, id: 'words', title, words: [{ word: 'hello', ru: 'привет' }] }],
};
const unit = { id: 'unit', title, dayIds: [day.id], days: [day] };
const license = { type: 'original' as const, attribution: 'Project authors' };
const pack: LoadedPack = {
  manifest: { id: 'test', name: title, version: '1', level: 'A1', visibility: 'public', license, attributions: [] },
  course: { id: 'test', title, level: 'A1', license, units: [unit] },
  units: [unit], days: new Map([[day.id, day]]), grammar: [],
};

beforeEach(() => {
  loadPublicPack.mockReset().mockRejectedValue(new Error('Failed to fetch a day: 502'));
  useContentStore.setState({ status: 'idle', pack: null, error: null });
  localStorage.setItem('onboarding.seen', '1');
});

const pages = [
  ['/', '/', DashboardPage],
  ['/course/unit/day/unit.d1', '/course/:unitId/day/:dayId', DayPage],
  ['/checkpoint/unit', '/checkpoint/:unitId', CheckpointPage],
  ['/placement', '/placement', PlacementPage],
  ['/progress', '/progress', ProgressPage],
] as const;

test.each(pages)('%s offers recovery when the course failed to load', async (url, path, Page) => {
  render(<MemoryRouter initialEntries={[url]}><Routes><Route path={path} element={<Page />} /></Routes></MemoryRouter>);
  expect(await screen.findByRole('button', { name: /retry loading/i })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toHaveTextContent(/could not be loaded/i);
  expect(screen.queryByText(/day not found|nothing to test yet|no diagnostic available/i)).not.toBeInTheDocument();
  expect(screen.queryByText(/Failed to fetch a day/)).not.toBeInTheDocument();
  if (url === '/progress') expect(screen.getByText('Local reading history')).toBeInTheDocument();
});

test('retrying a failed lesson opens that lesson without reloading or changing the route', async () => {
  loadPublicPack.mockRejectedValueOnce(new Error('502')).mockResolvedValue(pack);
  render(<MemoryRouter initialEntries={['/course/unit/day/unit.d1']}><Routes>
    <Route path="/course/:unitId/day/:dayId" element={<DayPage />} />
  </Routes></MemoryRouter>);

  fireEvent.click(await screen.findByRole('button', { name: /retry loading/i }));
  expect(await screen.findByRole('heading', { name: 'A recovered lesson', level: 1 })).toBeInTheDocument();
  expect(loadPublicPack).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a genuinely unknown lesson is still reported as missing after a successful load', async () => {
  loadPublicPack.mockResolvedValue(pack);
  render(<MemoryRouter initialEntries={['/course/unit/day/unknown']}><Routes>
    <Route path="/course/:unitId/day/:dayId" element={<DayPage />} />
  </Routes></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Day not found' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /retry loading/i })).not.toBeInTheDocument();
});
