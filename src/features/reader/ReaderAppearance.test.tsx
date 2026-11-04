import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { APPEARANCE_KEY, useTheme } from '@/features/appearance/themes';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  cancelSpeech,
  previewVoice,
  setPreferredVoiceURI,
} from '@/shared/lib/audio';
import { stampSetting } from '@/features/sync/local';
import { ReaderAppearance } from './ReaderAppearance';
import { useReaderSettings } from './settings';

const speech = vi.hoisted(() => ({ available: true }));
vi.mock('@/features/sync/local', () => ({
  stampSetting: vi.fn(async () => {}),
}));
vi.mock('@/shared/lib/useSpeechAvailable', () => ({
  useSpeechAvailable: () => speech.available,
}));
vi.mock('@/shared/lib/audio', () => ({
  cancelSpeech: vi.fn(),
  previewVoice: vi.fn(),
  setPreferredVoiceURI: vi.fn(),
  listEnglishVoices: () => [
    {
      voiceURI: 'native-en',
      name: 'Device English',
      lang: 'en-US',
      localService: true,
      default: true,
    },
  ],
  subscribeVoices: () => () => {},
}));

beforeEach(() => {
  vi.clearAllMocks();
  speech.available = true;
  useUiLang.setState({ lang: 'en' });
  useReaderSettings.setState({
    fontStep: 2,
    fontStepExplicit: true,
    fontFamily: null,
    lineStep: 0,
    coloring: true,
    voiceURI: null,
    storageError: false,
  });
  useTheme.setState({
    theme: 'studio',
    draft: null,
    dismissed: false,
    error: false,
  });
  useTheme.getState().cancel();
  localStorage.setItem(
    'oxford-reader-settings',
    JSON.stringify({
      fontStep: 2,
      fontFamily: null,
      fontScaleVersion: 2,
      coloring: true,
    })
  );
  localStorage.setItem(
    APPEARANCE_KEY,
    JSON.stringify({ theme: 'studio', dismissed: false })
  );
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});
afterEach(() => vi.restoreAllMocks());

function Host({ beforePreview = () => {} }: { beforePreview?: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Appearance</button>
      <ReaderAppearance
        open={open}
        onClose={() => setOpen(false)}
        returnFocus={() => screen.getByText('Appearance')}
        onBeforeVoicePreview={beforePreview}
      />
    </>
  );
}

async function open() {
  render(<Host />);
  await userEvent.click(screen.getByText('Appearance'));
}

test('appearance previews typography, highlighting and five real themes without writes, then Cancel restores them and focus', async () => {
  await open();
  const storedReader = localStorage.getItem('oxford-reader-settings');
  const storedTheme = localStorage.getItem(APPEARANCE_KEY);
  expect(
    screen.getByRole('heading', { name: 'Text appearance' })
  ).toHaveFocus();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
  await userEvent.selectOptions(screen.getByLabelText('Font'), 'sans');
  await userEvent.selectOptions(screen.getByLabelText('Line spacing'), '1');
  await userEvent.click(screen.getByRole('checkbox'));
  await userEvent.click(screen.getByRole('button', { name: 'Lagoon' }));
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 12,
    fontFamily: 'sans',
    lineStep: 1,
    coloring: false,
  });
  expect(document.documentElement.dataset.theme).toBe('lagoon');
  expect(localStorage.getItem('oxford-reader-settings')).toBe(storedReader);
  expect(localStorage.getItem(APPEARANCE_KEY)).toBe(storedTheme);
  expect(stampSetting).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 2,
    fontFamily: null,
    lineStep: 0,
    coloring: true,
  });
  expect(document.documentElement.dataset.theme).toBe('studio');
  expect(screen.getByText('Appearance')).toHaveFocus();
});

test('failed theme storage rolls reader preferences back, retains the draft and retries explicit Save', async () => {
  await open();
  const previous = localStorage.getItem('oxford-reader-settings');
  await userEvent.click(screen.getByRole('button', { name: 'Peony' }));
  fireEvent.change(screen.getByRole('slider'), { target: { value: '7' } });
  const original = Storage.prototype.setItem;
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(function (this: Storage, key, value) {
      if (key === APPEARANCE_KEY)
        throw new DOMException('denied', 'QuotaExceededError');
      original.call(this, key, value);
    });
  await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  expect(screen.getByRole('alert')).toHaveTextContent('could not save');
  expect(screen.getByRole('dialog')).toBeVisible();
  expect(localStorage.getItem('oxford-reader-settings')).toBe(previous);
  expect(localStorage.getItem(APPEARANCE_KEY)).toBe(
    JSON.stringify({ theme: 'studio', dismissed: false })
  );
  expect(screen.getByRole('slider')).toHaveValue('7');
  expect(useTheme.getState()).toMatchObject({
    theme: 'studio',
    draft: 'bloom',
  });
  expect(stampSetting).not.toHaveBeenCalled();
  write.mockRestore();
  await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(
    JSON.parse(localStorage.getItem('oxford-reader-settings')!)
  ).toMatchObject({ fontStep: 7 });
  expect(JSON.parse(localStorage.getItem(APPEARANCE_KEY)!)).toEqual({
    theme: 'bloom',
    dismissed: true,
  });
  expect(document.documentElement.dataset.theme).toBe('bloom');
});

test('only actual engine voices are listed, audition stops the existing reading session and Cancel stops the sample', async () => {
  const beforePreview = vi.fn();
  render(<Host beforePreview={beforePreview} />);
  await userEvent.click(screen.getByText('Appearance'));
  await userEvent.selectOptions(
    screen.getByLabelText('English read-aloud'),
    'native-en'
  );
  expect(setPreferredVoiceURI).not.toHaveBeenCalled();
  expect(
    screen
      .getAllByRole('option')
      .filter((option) => option.textContent?.includes('Device English'))
  ).toHaveLength(1);
  await userEvent.click(screen.getByRole('button', { name: /^Preview$/ }));
  expect(beforePreview).toHaveBeenCalledOnce();
  expect(previewVoice).toHaveBeenCalledWith('native-en', expect.any(String));
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(cancelSpeech).toHaveBeenCalledOnce();
  expect(useReaderSettings.getState().voiceURI).toBeNull();
});

test('unavailable speech is explicit and does not offer a synthetic replacement voice', async () => {
  speech.available = false;
  await open();
  expect(
    screen.getByText('Read-aloud is unavailable on this device.')
  ).toBeVisible();
  expect(screen.getByRole('button', { name: /^Preview$/ })).toBeDisabled();
  expect(screen.getByLabelText('English read-aloud')).toBeDisabled();
  expect(
    screen.getByRole('button', { name: 'Stop voice preview' })
  ).toBeDisabled();
});

test('Escape cancels the preview and a later reopening starts from saved preferences', async () => {
  await open();
  fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
  fireEvent(
    screen.getByRole('dialog'),
    new Event('cancel', { bubbles: false, cancelable: true })
  );
  expect(useReaderSettings.getState().fontStep).toBe(2);
  await userEvent.click(screen.getByText('Appearance'));
  expect(screen.getByRole('slider')).toHaveValue('2');
});

test('an initially open dialog retains reversible preview through StrictMode effect replay', async () => {
  const close = vi.fn();
  render(
    <StrictMode>
      <ReaderAppearance open onClose={close} returnFocus={() => null} />
    </StrictMode>
  );
  fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
  expect(useReaderSettings.getState().fontStep).toBe(12);
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(useReaderSettings.getState().fontStep).toBe(2);
  expect(close).toHaveBeenCalledOnce();
});

test('fresh book appearance shows its effective 22px, Cancel restores the default marker, and Save makes the displayed size explicit', async () => {
  useReaderSettings.setState({ fontStep: 2, fontStepExplicit: false });
  await open();
  expect(screen.getByRole('slider')).toHaveValue('7');
  expect(screen.getByRole('status')).toHaveTextContent('22 px');
  fireEvent.change(screen.getByRole('slider'), { target: { value: '12' } });
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 12,
    fontStepExplicit: true,
  });
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 2,
    fontStepExplicit: false,
  });
  await userEvent.click(screen.getByText('Appearance'));
  expect(screen.getByRole('slider')).toHaveValue('7');
  await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
  expect(useReaderSettings.getState()).toMatchObject({
    fontStep: 7,
    fontStepExplicit: true,
  });
  expect(
    JSON.parse(localStorage.getItem('oxford-reader-settings')!)
  ).toMatchObject({ fontStep: 7, fontStepExplicit: true });
});
