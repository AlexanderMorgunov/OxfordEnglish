import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import type { GrammarArticle } from '@/content/schema';
import {
  GrammarIndexPage,
  GrammarArticlePage,
} from '@/pages/GrammarReferencePage';
import { useGrammarStore } from '@/content/grammarStore';
import { useGrammarView } from './navigation';

const mocks = vi.hoisted(() => ({ grammar: vi.fn(), course: vi.fn() }));
vi.mock('@/content/loader', () => ({
  loadGrammarOnly: mocks.grammar,
  loadCourseIndexOnly: mocks.course,
}));
const topic = (
  id: string,
  title: string,
  level: 'A1' | 'A2' | 'B1' = 'A2'
): GrammarArticle => ({
  id,
  title: { en: title, ru: title },
  summary: { en: 'A real rule', ru: 'Правило' },
  level,
  blocks: [
    {
      heading: { en: 'Meaning', ru: 'Смысл' },
      text: { en: 'The original rule.', ru: 'Исходное правило.' },
      examples: [{ en: 'She works here.', ru: 'Она работает здесь.' }],
    },
  ],
});
const topics = [
  topic('present-simple', 'Present Simple'),
  topic('past-simple', 'Past Simple'),
  topic('past-perfect', 'Past Perfect', 'B1'),
  topic('future-topic', 'A new rule', 'A1'),
];

test('a fresh header navigation does not restore an old article anchor or steal focus', async () => {
  const scroll = vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
  useGrammarView.setState({ anchor: { id: 'past-simple', top: 20 } });
  render(<MemoryRouter initialEntries={['/other']}>
    <Link to="/grammar">Grammar in header</Link>
    <Routes><Route path="/other" element={<p>Another page</p>}/><Route path="/grammar" element={<GrammarIndexPage/>}/></Routes>
  </MemoryRouter>);
  await userEvent.click(screen.getByRole('link', {name:'Grammar in header'}));
  await screen.findByRole('link', {name:/Past Simple/});
  await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
  expect(screen.getByRole('link', {name:'Grammar in header'})).toHaveFocus();
  expect(scroll).not.toHaveBeenCalled();
  scroll.mockRestore();
});
const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView');
afterEach(() => {
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll);
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView');
});
const renderPage = (path = '/grammar') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/grammar" element={<GrammarIndexPage />} />
        <Route path="/grammar/:articleId" element={<GrammarArticlePage />} />
      </Routes>
    </MemoryRouter>
  );
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {value:vi.fn(),configurable:true});
  useGrammarStore.getState().cancel();
  useGrammarStore.setState({ status: 'idle', articles: [] });
  useGrammarView.getState().reset();
  mocks.grammar.mockReset().mockResolvedValue(topics);
  mocks.course
    .mockReset()
    .mockResolvedValue({ units: [{ id: 'actual-unit', dayIds: ['u01.d90'] }] });
});

test('search and CEFR combine without dropping unknown topic IDs', async () => {
  renderPage();
  await screen.findByRole('link', { name: /A new rule/ });
  await userEvent.type(screen.getByRole('searchbox'), 'прошедшее');
  expect(
    screen.queryByRole('link', { name: /Present Simple/ })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Past Simple/ })).toBeInTheDocument();
  await userEvent.click(
    screen.getByRole('button', { name: 'B1' })
  );
  expect(
    screen.getByRole('link', { name: /Past Perfect/ })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: /Past Simple/ })
  ).not.toBeInTheDocument();
  await userEvent.type(screen.getByRole('searchbox'), ' impossible');
  await userEvent.click(
    screen.getByRole('button', { name: 'Reset search and filters' })
  );
  expect(screen.getByRole('searchbox')).toHaveValue('');
  expect(screen.getByRole('searchbox')).toHaveFocus();
  expect(screen.getByRole('link', { name: /A new rule/ })).toBeInTheDocument();
});

test('cancel and retry fence a late successful response', async () => {
  let finish = (_topics: GrammarArticle[]) => {};
  mocks.grammar.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel loading' }));
  expect(
    screen.getByRole('heading', { name: 'Loading cancelled' })
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  await screen.findByRole('link', { name: /Present Simple/ });
  await act(async () => {
    finish([topic('obsolete', 'Obsolete rule')]);
  });
  expect(
    screen.queryByRole('link', { name: /Obsolete/ })
  ).not.toBeInTheDocument();
  expect(useGrammarStore.getState().articles).toEqual(topics);
});

test('a retry preserves typed search and does not steal focus', async () => {
  mocks.grammar.mockRejectedValueOnce(new Error('offline'));
  renderPage();
  await screen.findByRole('heading', { name: 'The reference did not load' });
  await userEvent.type(screen.getByRole('searchbox'), 'Past');
  let finish = (_topics: GrammarArticle[]) => {};
  mocks.grammar.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      })
  );
  await userEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
  act(() => screen.getByRole('searchbox').focus());
  await act(async () => finish(topics));
  expect(screen.getByRole('searchbox')).toHaveValue('Past');
  expect(screen.getByRole('searchbox')).toHaveFocus();
});

test('source lesson resolves its actual unit and survives related and index links', async () => {
  mocks.grammar.mockResolvedValue([
    { ...topics[0]!, seeAlso: ['past-simple', 'missing', 'present-simple'] },
    topics[1]!,
  ]);
  renderPage('/grammar/present-simple?from=u01.d90');
  await screen.findByRole('heading', { level: 1, name: 'Present Simple' });
  const back = await screen.findAllByRole('link', {
    name: /Back to your lesson/,
  });
  expect(back[0]).toHaveAttribute('href', '/course/actual-unit/day/u01.d90');
  const related = screen.getByRole('link', { name: /Past Simple/ });
  expect(related).toHaveAttribute('href', '/grammar/past-simple?from=u01.d90');
  await userEvent.click(related);
  expect(
    await screen.findByRole('heading', { level: 1, name: 'Past Simple' })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← All rules' })).toHaveAttribute(
    'href',
    '/grammar?from=u01.d90'
  );
  expect(mocks.grammar).toHaveBeenCalledTimes(1);
});

test('reader context is not interpreted as a lesson ID', async () => {
  renderPage('/grammar/present-simple?from=reader');
  await screen.findByRole('heading', { level: 1, name: 'Present Simple' });
  expect(
    screen.getByRole('button', { name: /back to reading/ })
  ).toBeInTheDocument();
  expect(
    screen.queryByRole('link', { name: /Back to your lesson/ })
  ).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: '← All rules' })).toHaveAttribute(
    'href',
    '/grammar?from=reader'
  );
  expect(mocks.course).not.toHaveBeenCalled();
});

test('TOC and content use the actual blocks, including missing optional fields', async () => {
  mocks.grammar.mockResolvedValue([
    {
      id: 'minimal',
      title: { en: 'Minimal' },
      summary: { en: 'Summary' },
      blocks: [{ text: { en: 'The complete original rule.' } }],
    },
  ]);
  renderPage('/grammar/minimal');
  await screen.findByRole('heading', { level: 1, name: 'Minimal' });
  expect(screen.getByText('The complete original rule.')).toBeInTheDocument();
  expect(
    screen.queryByRole('heading', { name: 'Common mistakes' })
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByText('In this rule', {selector:'summary'}));
  const nav = screen.getByRole('navigation', {name:'Rule contents on mobile'});
  expect(within(nav).getByRole('link', { name: 'The rule' })).toHaveAttribute(
    'href',
    '#grammar-block-0'
  );
  fireEvent.click(within(nav).getByRole('link', { name: 'The rule' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'The rule' })).toHaveFocus()
  );
});
