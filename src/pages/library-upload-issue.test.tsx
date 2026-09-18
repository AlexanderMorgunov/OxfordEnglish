/**
 * The library is where a stuck upload has to become visible — recording it and showing nothing would be
 * the same bug in a new place. Also pins WHICH reason is shown, because the four read very differently:
 * two are permanent facts about the file or the account, two resolve themselves on the next sweep.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { create } from 'zustand';
import type { UploadIssue } from '@/features/reader/blobSync';

const issueStore = create<{ issues: Record<string, UploadIssue> }>(() => ({ issues: {} }));
const syncStore = create<{ enabled: boolean }>(() => ({ enabled: true }));
const accountStore = create<{ status: 'authenticated' | 'anonymous' }>(() => ({ status: 'authenticated' }));

vi.mock('@/features/reader/blobSync', () => ({ useBookUploadIssues: issueStore, useBookFileSync: syncStore }));
vi.mock('@/features/account/store', () => ({ useAccount: accountStore }));
const book = (id: string, title: string) => ({ id, title, author: 'Stoker', format: 'epub', chapterCount: 5, addedAt: 1, lastChapter: 0 });
let shelf = [book('b1', 'Dracula')];
vi.mock('@/features/reader/service', () => ({
  listBooks: async () => shelf,
  importBook: vi.fn(),
  removeBook: vi.fn(),
}));
vi.mock('@/features/reader/storage', () => ({ opfsAvailable: () => true, requestPersistence: async () => true }));
vi.mock('@/features/reader/RecommendedShelf', () => ({ RecommendedShelf: () => null }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/stats/useReadingTracker', () => ({ readProgress: () => null }));

// jsdom has no navigator.storage; the page asks it whether storage is persisted on mount.
Object.defineProperty(navigator, 'storage', { value: { persisted: async () => true }, configurable: true });

const { LibraryPage } = await import('./LibraryPage');

const view = () => render(<LibraryPage />, { wrapper: MemoryRouter });

beforeEach(() => {
  issueStore.setState({ issues: {} });
  syncStore.setState({ enabled: true });
  accountStore.setState({ status: 'authenticated' });
  shelf = [book('b1', 'Dracula')];
});

test('a book with nothing wrong says nothing about the cloud', async () => {
  view();
  expect(await screen.findByText('Dracula')).toBeInTheDocument();
  expect(screen.queryByText(/cloud/i)).not.toBeInTheDocument();
});

test('an oversized file is named as permanent, and says the book is still here', async () => {
  issueStore.setState({ issues: { b1: 'too-large' } });
  view();
  expect(await screen.findByText(/will not go to the cloud/i)).toBeInTheDocument();
  expect(screen.getByText(/here on this device/i)).toBeInTheDocument();
});

test('the paywall reason points at Pro, and never promises a retry', async () => {
  issueStore.setState({ issues: { b1: 'no-plan' } });
  view();
  expect(await screen.findByText(/part of Pro/i)).toBeInTheDocument();
  expect(screen.queryByText(/try again/i)).not.toBeInTheDocument();
});

test('a transient failure promises the retry that actually exists', async () => {
  issueStore.setState({ issues: { b1: 'error' } });
  view();
  expect(await screen.findByText(/try again automatically/i)).toBeInTheDocument();
});

test('the marker is keyed to the book it belongs to', async () => {
  issueStore.setState({ issues: { someOtherBook: 'quota' } });
  view();
  expect(await screen.findByText('Dracula')).toBeInTheDocument();
  expect(screen.queryByText(/cloud/i)).not.toBeInTheDocument();
});

test('there is no retry button — the sweep already retries', async () => {
  issueStore.setState({ issues: { b1: 'error' } });
  view();
  await screen.findByText(/try again automatically/i);
  expect(screen.queryByRole('button', { name: /retry|try again/i })).not.toBeInTheDocument();
});

test('a full account is named as full, and the fix is on the user', async () => {
  // The reason most likely to be on screen for a WHOLE library, since it stops the sweep.
  issueStore.setState({ issues: { b1: 'quota' } });
  view();
  expect(await screen.findByText(/did not fit in the cloud/i)).toBeInTheDocument();
  expect(screen.getByText(/free some space/i)).toBeInTheDocument();
});

test('a sign-in that will not refresh says so, rather than blaming the book', async () => {
  issueStore.setState({ issues: { b1: 'signed-out' } });
  view();
  expect(await screen.findByText(/cannot refresh your sign-in/i)).toBeInTheDocument();
});

test('a permanent reason is muted and a temporary one is amber', async () => {
  issueStore.setState({ issues: { b1: 'too-large' } });
  const { unmount } = view();
  expect((await screen.findByText(/will not go to the cloud/i)).className).toContain('text-muted');
  unmount();

  issueStore.setState({ issues: { b1: 'error' } });
  view();
  expect((await screen.findByText(/try again automatically/i)).className).toContain('text-amber');
});

test('the status text stays out of the book link accessible name', async () => {
  issueStore.setState({ issues: { b1: 'quota' } });
  view();
  const link = await screen.findByRole('link', { name: /Dracula/i });
  expect(link.textContent).not.toMatch(/cloud/i);
});

describe('a marker is only shown while the thing that would fix it is running', () => {
  // Not cleared on the way out, DERIVED: turning the toggle back on brings the real answers straight
  // back instead of a ten-minute blank, and nothing in storage has to be rebuilt.
  test('nothing is shown once the toggle is off', async () => {
    issueStore.setState({ issues: { b1: 'error' } });
    syncStore.setState({ enabled: false });
    view();
    expect(await screen.findByText('Dracula')).toBeInTheDocument();
    expect(screen.queryByText(/cloud/i)).not.toBeInTheDocument();
  });

  test('nothing is shown once signed out', async () => {
    issueStore.setState({ issues: { b1: 'error' } });
    accountStore.setState({ status: 'anonymous' });
    view();
    expect(await screen.findByText('Dracula')).toBeInTheDocument();
    expect(screen.queryByText(/cloud/i)).not.toBeInTheDocument();
  });

  test('and it comes back when both are true again', async () => {
    issueStore.setState({ issues: { b1: 'quota' } });
    view();
    expect(await screen.findByText(/did not fit in the cloud/i)).toBeInTheDocument();
  });
});

describe('one reason covering several books is explained once, not under each of them', () => {
  // Found in the browser, not here: three books produced three identical two-line blocks, which is what
  // a free account, a full cloud or a dropped connection all look like. The single-book fixture every
  // other test uses could never show it.
  test('two books with the same reason share one explanation and carry a short marker', async () => {
    shelf = [book('b1', 'Dracula'), book('b2', 'Frankenstein')];
    issueStore.setState({ issues: { b1: 'no-plan', b2: 'no-plan' } });
    view();

    expect(await screen.findByText(/Cloud copies of books are part of Pro/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^not in the cloud$/i)).toHaveLength(2);
    expect(screen.queryByText(/A cloud copy is part of Pro/i)).not.toBeInTheDocument();
  });

  test('a reason affecting one book alone stays on that book, in full', async () => {
    shelf = [book('b1', 'Dracula')];
    issueStore.setState({ issues: { b1: 'no-plan' } });
    view();

    expect(await screen.findByText(/A cloud copy is part of Pro/i)).toBeInTheDocument();
    expect(screen.queryByText(/Cloud copies of books are part of Pro/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/^not in the cloud$/i)).not.toBeInTheDocument();
  });

  test('the grouped reason and a lone one coexist without stealing each other\'s text', async () => {
    shelf = [book('b1', 'Dracula'), book('b2', 'Frankenstein'), book('b3', 'The Odyssey')];
    issueStore.setState({ issues: { b1: 'too-large', b2: 'error', b3: 'error' } });
    view();

    expect(await screen.findByText(/The marked books are not in the cloud yet/i)).toBeInTheDocument();
    expect(screen.getAllByText(/^not in the cloud$/i)).toHaveLength(2);
    expect(screen.getByText(/over 20 MB/i)).toBeInTheDocument();
  });
});

test('two reasons each covering several books both get explained', async () => {
  // Explaining only the biggest group left the other group's books showing a bare "not in the cloud"
  // with the reason stated nowhere on the page — worse than the repetition the grouping replaced.
  shelf = [book('b1', 'Dracula'), book('b2', 'Frankenstein'), book('b3', 'The Odyssey'), book('b4', 'Moby Dick')];
  issueStore.setState({ issues: { b1: 'error', b2: 'error', b3: 'too-large', b4: 'too-large' } });
  view();

  expect(await screen.findByText(/The marked books are not in the cloud yet/i)).toBeInTheDocument();
  expect(screen.getByText(/The marked files are over 20 MB/i)).toBeInTheDocument();
  expect(screen.getAllByText(/^not in the cloud$/i)).toHaveLength(4);
});
