/**
 * What the library says when the platform refuses to guarantee the files.
 *
 * In the Android app `persist()` is ALWAYS refused — that is how the WebView behaves, not a fault —
 * so this card is permanent there, and the browser wording sends every store user hunting for an
 * "Add to Home Screen" that an installed app does not have. The warning is right; only its remedy
 * has to change with the platform.
 */
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { create } from 'zustand';

const issueStore = create<{ issues: Record<string, never> }>(() => ({ issues: {} }));
const syncStore = create<{ enabled: boolean }>(() => ({ enabled: false }));
const accountStore = create<{ status: 'anonymous' }>(() => ({ status: 'anonymous' }));

vi.mock('@/features/reader/blobSync', () => ({ useBookUploadIssues: issueStore, useBookFileSync: syncStore }));
vi.mock('@/features/account/store', () => ({ useAccount: accountStore }));
vi.mock('@/features/reader/service', () => ({ listBooks: async () => [], importBook: vi.fn(), removeBook: vi.fn() }));
vi.mock('@/features/reader/storage', () => ({ opfsAvailable: () => true, requestPersistence: async () => false }));
vi.mock('@/features/reader/RecommendedShelf', () => ({ RecommendedShelf: () => null }));
vi.mock('@/features/reader/BackToReader', () => ({ BackToReader: () => null }));
vi.mock('@/features/stats/useReadingTracker', () => ({ readProgress: () => null }));

// Refused, which is what the Android WebView always answers.
Object.defineProperty(navigator, 'storage', { value: { persisted: async () => false }, configurable: true });

const { LibraryPage } = await import('./LibraryPage');

afterEach(() => {
  Reflect.deleteProperty(globalThis as object, 'Capacitor');
});

const HOME_SCREEN = /на экран домой|add to home screen/i;

test('in a browser the advice is to install to the home screen', async () => {
  render(<LibraryPage />, { wrapper: MemoryRouter });

  expect(await screen.findByText(HOME_SCREEN)).toBeInTheDocument();
});

test('in the app the advice is something the user can actually do', async () => {
  (globalThis as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };

  render(<LibraryPage />, { wrapper: MemoryRouter });

  // Still warned — the files really are evictable there.
  expect(await screen.findByText(/внутри приложения|inside the app/i)).toBeInTheDocument();
  // But never sent after a home-screen button that does not exist in an installed app.
  expect(screen.queryByText(HOME_SCREEN)).toBeNull();
});
