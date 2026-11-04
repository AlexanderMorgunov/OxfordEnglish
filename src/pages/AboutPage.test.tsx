import 'fake-indexeddb/auto';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { createEmptyCard } from 'ts-fsrs';
import { db } from '@/db/db';
import { invalidateDataScope } from '@/features/account/dataScope';
import { AboutPage } from './AboutPage';

const speech = vi.hoisted(() => ({
  stop: vi.fn(),
  speak: vi.fn(),
  error: '',
  playing: null,
}));
vi.mock('@/features/vocab/useVocabularySpeech', () => ({
  useVocabularySpeech: () => speech,
}));
const tracking = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock('@/features/analytics/analytics', () => tracking);
const renderPage = (path = '/about') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <AboutPage />
    </MemoryRouter>
  );
const demo = () =>
  screen.getByRole('region', {
    name: 'Interactive reading and review example',
  });
const count = () => within(demo()).getByText(/Example entries:/);
const word = async (term = 'journey') =>
  userEvent.click(screen.getByRole('button', { name: `Translate ${term}` }));
const save = async () =>
  userEvent.click(screen.getByRole('button', { name: 'Save word' }));
const review = async () =>
  userEvent.click(screen.getByRole('button', { name: 'Try reviewing' }));
beforeEach(() => {
  vi.clearAllMocks();
  speech.error = '';
  speech.playing = null;
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

test('explains the product with real internal destinations and no fixed commercial promises', () => {
  renderPage();
  expect(
    screen.getByRole('heading', { level: 1, name: 'Learn English. Read books in English.' })
  ).toBeInTheDocument();
  expect(
    screen.getAllByRole('link', { name: /Open the learning path/i })[0]
  ).toHaveAttribute('href', '/');
  expect(screen.getByRole('link', { name: /Explore Pro/ })).toHaveAttribute(
    'href',
    '/pro'
  );
  expect(
    screen.getByRole('link', { name: 'Credits and licences' })
  ).toHaveAttribute('href', '/credits');
  expect(
    screen.getByRole('link', { name: 'Manage data in Settings' })
  ).toHaveAttribute('href', '/settings/data');
  expect(
    screen.getByText(/enabling book-file sync uploads files/)
  ).toBeInTheDocument();
  expect(
    screen.queryByText(
      /in 3 days|never sent anywhere|right before you would forget/i
    )
  ).toBeNull();
  for (const link of screen.getAllByRole('link'))
    expect(link).not.toHaveAttribute('target', '_blank');
});
test('looking up a word does not save it; deliberate saving creates one demo entry', async () => {
  renderPage();
  expect(screen.queryByRole('button', { name: 'Save word' })).toBeNull();
  await word();
  expect(
    screen.getByText('a trip from one place to another')
  ).toBeInTheDocument();
  expect(count()).toHaveTextContent('0');
  await save();
  expect(count()).toHaveTextContent('1');
  await userEvent.click(
    screen.getByRole('button', { name: 'Back to reading' })
  );
  await word();
  expect(screen.getByText(/Already saved in this example/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save word' })).toBeNull();
  expect(count()).toHaveTextContent('1');
});
test('review hides the meaning until reveal and replacing a rating creates no extra entry', async () => {
  renderPage();
  await word();
  await save();
  await review();
  expect(screen.queryByRole('group', { name: 'Rate your recall' })).toBeNull();
  expect(screen.queryByText('a trip from one place to another')).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  await userEvent.click(screen.getByRole('button', { name: /^Good:/ }));
  expect(screen.getByText(/Example completed/)).toBeInTheDocument();
  expect(count()).toHaveTextContent('1');
  await userEvent.click(
    screen.getByRole('button', { name: 'Change example rating' })
  );
  await userEvent.click(screen.getByRole('button', { name: /^Again:/ }));
  expect(screen.getByText('Again', { selector: 'strong' })).toBeInTheDocument();
  expect(count()).toHaveTextContent('1');
});
test('phrase selection works in reverse and unsupported ranges cannot be saved', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: 'Phrase' }));
  await userEvent.click(screen.getByRole('button', { name: 'time' }));
  expect(screen.queryByRole('button', { name: 'Save phrase' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'your' }));
  expect(
    screen.getByText(/no prepared answer for this range/)
  ).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save phrase' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'time' }));
  await userEvent.click(screen.getByRole('button', { name: 'Take' }));
  expect(screen.getByText('do it without hurrying')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Save phrase' }));
  expect(count()).toHaveTextContent('1');
});
test('keyboard shortcuts are scoped to the example and never activate before reveal', async () => {
  renderPage();
  await word();
  await save();
  await review();
  demo().focus();
  await userEvent.keyboard('3');
  expect(screen.queryByText(/Example completed/)).toBeNull();
  await userEvent.keyboard('[Space]');
  expect(
    screen.getByRole('group', { name: 'Rate your recall' })
  ).toBeInTheDocument();
  screen.getByRole('link', { name: 'Questions' }).focus();
  await userEvent.keyboard('3');
  expect(screen.queryByText(/Example completed/)).toBeNull();
  demo().focus();
  await userEvent.keyboard('3');
  expect(screen.getByText(/Example completed/)).toBeInTheDocument();
});
test('reset and account handover clear the prepared example, including its grades', async () => {
  renderPage();
  await word();
  await save();
  await userEvent.click(
    screen.getByRole('button', { name: 'Restart example' })
  );
  expect(count()).toHaveTextContent('0');
  await word('serene');
  await save();
  await act(async () => invalidateDataScope());
  expect(count()).toHaveTextContent('0');
  expect(screen.queryByRole('button', { name: 'Try reviewing' })).toBeNull();
});
test('native FAQ items expand independently and hash entry focuses the real section', async () => {
  renderPage('/about#faq');
  expect(document.activeElement).toHaveAttribute('id', 'faq');
  const first = screen.getByText('Do I need an account?', {
      selector: 'summary',
    }),
    second = screen.getByText('What works offline?', { selector: 'summary' });
  await userEvent.click(first);
  await userEvent.click(second);
  expect(first.closest('details')).toHaveAttribute('open');
  expect(second.closest('details')).toHaveAttribute('open');
  expect(second.closest('details')).toHaveTextContent(
    'Previously downloaded materials'
  );
});
test('speech uses the app engine and errors do not change or disable the prepared meaning', async () => {
  speech.error = 'English speech unavailable';
  renderPage();
  await word();
  await userEvent.click(
    screen.getByRole('button', { name: 'Pronounce journey' })
  );
  expect(speech.speak).toHaveBeenCalledWith('journey');
  expect(screen.getByText('English speech unavailable')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save word' })).toBeEnabled();
});
test('the full example leaves real vocabulary, schedules, attempts and learning milestones unchanged', async () => {
  await db.open();
  const card = createEmptyCard(new Date(0));
  await db.srsCards.put({
    id: 'word:real',
    kind: 'word',
    front: 'real',
    back: 'настоящий',
    tags: [],
    card,
    due: card.due,
  });
  const snapshot = async () =>
    Promise.all([
      db.srsCards.toArray(),
      db.wordStatus.toArray(),
      db.reviewLog.toArray(),
      db.attempts.toArray(),
    ]);
  const before = await snapshot();
  renderPage();
  await word();
  await save();
  await review();
  await userEvent.click(screen.getByRole('button', { name: 'Show answer' }));
  await userEvent.click(screen.getByRole('button', { name: /^Good:/ }));
  expect(await snapshot()).toEqual(before);
  expect(tracking.track).not.toHaveBeenCalled();
  await userEvent.click(
    screen.getAllByRole('link', { name: /Open the learning path/ })[0]!
  );
  expect(tracking.track).toHaveBeenCalledWith(
    'landing_cta',
    expect.objectContaining({ to: '/', from: 'hero' })
  );
});
