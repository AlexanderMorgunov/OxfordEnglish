import 'fake-indexeddb/auto';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import {
  cleanup,
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { SettingsPage } from '@/pages/SettingsPage';
import { useAiStore } from '@/features/ai/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { useEntitlement } from '@/features/account/entitlement';
import { safeSettingsReturn } from './navigation';

vi.mock('@/features/account/AccountSection', () => ({
  AccountSection: () => <p>Account actions</p>,
  BookFileSyncToggle: () => null,
  SyncStatusLine: () => null,
}));

beforeEach(() => {
  useUiLang.setState({ lang: 'en' });
  useAiStore.setState({ config: null, keys: {} });
  useEntitlement.setState({ entitlement: null, loading: false });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
function page(path = '/settings/ai') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/settings/:section?" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
}

test('responsive settings changes preserve focus in the global navigation', () => {
  let matches = true;
  const events = new EventTarget();
  const media: MediaQueryList = {
    get matches() {
      return matches;
    },
    media: '(min-width: 900px)',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
  };
  const original = window.matchMedia;
  vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
    query === media.media ? media : original(query)
  );
  render(
    <MemoryRouter initialEntries={['/settings']}>
      <header className="app-header">
        <button>Global navigation</button>
      </header>
      <Routes>
        <Route path="/settings" element={<SettingsPage />} />
      </Routes>
    </MemoryRouter>
  );
  const navigation = screen.getByRole('button', { name: 'Global navigation' });
  act(() => navigation.focus());
  act(() => {
    matches = false;
    events.dispatchEvent(new Event('change'));
  });
  expect(navigation).toHaveFocus();
});

test('provider drafts survive provider changes and internal section navigation', async () => {
  const user = userEvent.setup();
  page();
  await user.click(screen.getByText('Connect your own AI'));
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'synthetic-groq-draft' },
  });
  await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'synthetic-custom-draft' },
  });
  await user.click(screen.getByRole('link', { name: 'Appearance' }));
  expect(
    screen.getByRole('heading', { name: 'Appearance' })
  ).toBeInTheDocument();
  await user.click(screen.getByRole('link', { name: 'AI assistant' }));
  expect(screen.getByLabelText('API key')).toHaveValue(
    'synthetic-custom-draft'
  );
  await user.selectOptions(screen.getByLabelText('Provider'), 'groq');
  expect(screen.getByLabelText('API key')).toHaveValue('synthetic-groq-draft');
  expect(useAiStore.getState().config).toBeNull();
});

test('invalid custom endpoint focuses the error and failed persistence preserves input', async () => {
  const user = userEvent.setup();
  page();
  await user.click(screen.getByText('Connect your own AI'));
  await user.selectOptions(screen.getByLabelText('Provider'), 'custom');
  fireEvent.change(screen.getByLabelText('API key'), {
    target: { value: 'synthetic-draft' },
  });
  fireEvent.change(screen.getByLabelText('Model'), {
    target: { value: 'test-model' },
  });
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'javascript:bad' },
  });
  await user.click(screen.getByRole('button', { name: 'Save key' }));
  expect(screen.getByLabelText('Base URL')).toHaveFocus();
  expect(useAiStore.getState().config).toBeNull();
  fireEvent.change(screen.getByLabelText('Base URL'), {
    target: { value: 'https://example.com/v1' },
  });
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('denied');
    });
  await user.click(screen.getByRole('button', { name: 'Save key' }));
  expect(
    screen.getByText(/Could not save changes on this device/)
  ).toBeInTheDocument();
  expect(screen.getByLabelText('API key')).toHaveValue('synthetic-draft');
  write.mockRestore();
  await user.click(screen.getByRole('button', { name: 'Save key' }));
  expect(useAiStore.getState().config?.provider).toBe('custom');
});

test('legacy AI link opens the right section and preserves a safe return URL', async () => {
  page(
    '/settings?from=%2Fcourse%2Fu02%2Fday%2Fu02.d01%3Ffrom%3Dreader#ai-section'
  );
  expect(
    screen.getByRole('heading', { name: 'AI assistant' })
  ).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Appearance' })).toHaveAttribute(
    'href',
    '/settings/interface?from=%2Fcourse%2Fu02%2Fday%2Fu02.d01%3Ffrom%3Dreader'
  );
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'AI assistant' })).toHaveFocus()
  );
});

test.each([
  '//outside.test',
  '/\\outside.test',
  'https://outside.test',
  'javascript:alert(1)',
  '/settings/ai',
])('rejects unsafe or looping return path %s', (path) => {
  expect(safeSettingsReturn(path)).toBeNull();
});
