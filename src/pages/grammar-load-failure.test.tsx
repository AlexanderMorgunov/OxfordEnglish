/**
 * What the grammar reference says when it could not load.
 *
 * It used to say "article not found" — and since Googlebot renders the JS and indexes the result, that
 * is what all 48 topic pages reported to Google while robots.txt blocked the file they render from
 * (Search Console 2026-09-24: 9 indexed, 81 not). A failed request and a missing article are different
 * facts and must not share a sentence.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { GrammarArticle } from '@/content/schema';

const loadGrammarOnly = vi.fn<() => Promise<GrammarArticle[]>>();
vi.mock('@/content/loader', () => ({ loadGrammarOnly: () => loadGrammarOnly() }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));

const { useGrammarStore } = await import('@/content/grammarStore');
const { GrammarArticlePage, GrammarIndexPage } = await import('./GrammarReferencePage');

const PRESENT_SIMPLE: GrammarArticle = {
  id: 'present-simple',
  title: { ru: 'Present Simple', en: 'Present Simple' },
  summary: { ru: 'Для привычек', en: 'For habits' },
  blocks: [{ text: { ru: 'Правило', en: 'The rule' } }],
};

const NOT_FOUND = /article not found|статья не найдена/i;
const COMING_SOON = /coming soon|скоро появятся/i;
const DID_NOT_LOAD = /did not load|не загрузился|could not be loaded|не удалось загрузить/i;

beforeEach(() => {
  useGrammarStore.setState({ status: 'idle', articles: [] });
});
afterEach(() => {
  loadGrammarOnly.mockReset();
});

const article = (id: string) =>
  render(
    <MemoryRouter initialEntries={[`/grammar/${id}`]}>
      <Routes>
        <Route path="/grammar/:articleId" element={<GrammarArticlePage />} />
      </Routes>
    </MemoryRouter>
  );

test('a failed load is reported as a failed load, not as a missing article', async () => {
  loadGrammarOnly.mockRejectedValue(new Error('blocked by robots.txt'));

  article('present-simple');

  expect(await screen.findByText(DID_NOT_LOAD)).toBeInTheDocument();
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
});

test('an id that really is not in the reference is still a 404', async () => {
  loadGrammarOnly.mockResolvedValue([PRESENT_SIMPLE]);

  article('no-such-topic');

  expect(await screen.findByText(NOT_FOUND)).toBeInTheDocument();
});

test('a known id renders the article', async () => {
  loadGrammarOnly.mockResolvedValue([PRESENT_SIMPLE]);

  article('present-simple');

  expect(await screen.findByRole('heading', { name: 'Present Simple', level: 1 })).toBeInTheDocument();
  expect(screen.queryByText(NOT_FOUND)).not.toBeInTheDocument();
});

test('the hub does not claim the articles are coming soon when the request failed', async () => {
  loadGrammarOnly.mockRejectedValue(new Error('offline'));

  render(<GrammarIndexPage />, { wrapper: MemoryRouter });

  expect(await screen.findByText(DID_NOT_LOAD)).toBeInTheDocument();
  expect(screen.queryByText(COMING_SOON)).not.toBeInTheDocument();
});

test('an empty reference that loaded fine still says the articles are coming', async () => {
  loadGrammarOnly.mockResolvedValue([]);

  render(<GrammarIndexPage />, { wrapper: MemoryRouter });

  expect(await screen.findByText(COMING_SOON)).toBeInTheDocument();
});

// The whole point of the fix: one request, not the 213 day files the full pack reads first.
test('the reference loads without the rest of the pack', async () => {
  loadGrammarOnly.mockResolvedValue([PRESENT_SIMPLE]);

  render(<GrammarIndexPage />, { wrapper: MemoryRouter });
  await screen.findByRole('link', { name: /Present Simple/ });

  expect(loadGrammarOnly).toHaveBeenCalledTimes(1);
});
