import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, test, vi } from 'vitest';
import { CommunitySection } from './CommunitySection';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function clipboard(writeText?: (value: string) => Promise<void>) {
  vi.stubGlobal('navigator', {
    ...navigator,
    clipboard: writeText ? { writeText } : undefined,
  });
}
const channel = (name: string) => within(screen.getByRole('article', { name }));

test('clipboard denial exposes the exact selectable address and allows a retry', async () => {
  const writeText = vi
    .fn()
    .mockRejectedValueOnce(new Error('Denied'))
    .mockResolvedValueOnce(undefined);
  clipboard(writeText);
  render(<CommunitySection />);
  const telegram = channel('Telegram');
  const copy = telegram.getByRole('button', { name: 'Copy Telegram link' });
  await userEvent.click(copy);
  const address = telegram.getByRole('textbox', {
    name: 'Copy the address manually',
  });
  expect(address).toHaveValue('https://t.me/dayenglishru');
  expect(address).toHaveAttribute('readonly');
  expect(address).toHaveFocus();
  expect((address as HTMLInputElement).selectionEnd).toBe(
    'https://t.me/dayenglishru'.length
  );
  expect(copy).toBeEnabled();
  await userEvent.click(copy);
  expect(writeText).toHaveBeenLastCalledWith('https://t.me/dayenglishru');
  expect(telegram.getByRole('status')).toHaveTextContent('Link copied');
  expect(telegram.queryByRole('textbox')).toBeNull();
});

test('an unavailable clipboard still offers manual copying', async () => {
  clipboard();
  render(<CommunitySection />);
  const vk = channel('VK');
  await userEvent.click(vk.getByRole('button', { name: 'Copy VK link' }));
  expect(vk.getByRole('textbox')).toHaveValue('https://vk.ru/club242958850');
  expect(vk.getByRole('status')).toHaveTextContent(
    'Could not copy automatically'
  );
  await userEvent.click(vk.getByRole('button', { name: 'Select link' }));
  const address = vk.getByRole('textbox') as HTMLInputElement;
  expect(address.selectionStart).toBe(0);
  expect(address.selectionEnd).toBe(address.value.length);
});

test('simultaneous channel copies keep independent pending and completion states', async () => {
  const telegramCopy = deferred(),
    vkCopy = deferred();
  clipboard((url) =>
    url === 'https://t.me/dayenglishru' ? telegramCopy.promise : vkCopy.promise
  );
  render(<CommunitySection />);
  const telegram = channel('Telegram'),
    vk = channel('VK');
  const telegramButton = telegram.getByRole('button', {
    name: 'Copy Telegram link',
  });
  const vkButton = vk.getByRole('button', { name: 'Copy VK link' });
  await userEvent.click(telegramButton);
  await userEvent.click(vkButton);
  expect(telegramButton).toBeDisabled();
  expect(vkButton).toBeDisabled();
  await act(async () => telegramCopy.resolve());
  expect(telegram.getByRole('status')).toHaveTextContent('Link copied');
  expect(vk.getByRole('status')).toHaveTextContent('Copying link…');
  expect(vkButton).toBeDisabled();
  await act(async () => vkCopy.resolve());
  expect(vk.getByRole('status')).toHaveTextContent('Link copied');
  expect(vkButton).toBeEnabled();
});

test('a late copy cannot finish a newer attempt after pagehide', async () => {
  const oldCopy = deferred(),
    newCopy = deferred();
  clipboard(
    vi
      .fn()
      .mockReturnValueOnce(oldCopy.promise)
      .mockReturnValueOnce(newCopy.promise)
  );
  render(<CommunitySection />);
  const telegram = channel('Telegram');
  const button = telegram.getByRole('button', { name: 'Copy Telegram link' });
  await userEvent.click(button);
  act(() => fireEvent(window, new Event('pagehide')));
  expect(button).toBeEnabled();
  expect(telegram.getByRole('status')).toBeEmptyDOMElement();
  await userEvent.click(button);
  await act(async () => oldCopy.resolve());
  expect(button).toBeDisabled();
  expect(telegram.getByRole('status')).toHaveTextContent('Copying link…');
  await act(async () => newCopy.resolve());
  expect(button).toBeEnabled();
  expect(telegram.getByRole('status')).toHaveTextContent('Link copied');
});
