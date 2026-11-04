import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookmarkList } from './BookmarkList';
import type { Bookmark } from './bookmarks';
import { useReaderSettings } from './settings';
import { invalidateDataScope } from '@/features/account/dataScope';

const first: Bookmark = {
  id: 'earlier-page',
  bookKey: 'reader.catalog.test',
  page: 0,
  pageId: 'one',
  paragraph: 1,
  sentence: 2,
  snippet: 'The first place.',
  chapterTitle: 'Chapter One',
  createdAt: 10,
};
const latest: Bookmark = {
  ...first,
  id: 'latest',
  page: 2,
  pageId: 'three',
  paragraph: 0,
  sentence: 0,
  snippet: 'A later place.',
  chapterTitle: 'Chapter Three',
  createdAt: 20,
};
const progress = new Map([
  [first.id, 0.1],
  [latest.id, 0.7],
]);
beforeEach(() => {
  useReaderSettings.setState({ bookmarkSort: 'recent' });
});
afterEach(cleanup);

test('sorting changes displayed order and each jump retains the exact source bookmark', async () => {
  const jump = vi.fn();
  render(
    <BookmarkList
      bookmarks={[first, latest]}
      progress={progress}
      onJump={jump}
      onDelete={vi.fn()}
    />
  );
  const list = within(screen.getByRole('list', { name: 'Bookmarks' }));
  expect(list.getAllByRole('listitem')[0]).toHaveTextContent(latest.snippet);
  await userEvent.selectOptions(
    screen.getByRole('combobox', { name: 'Bookmark order' }),
    'book'
  );
  expect(useReaderSettings.getState().bookmarkSort).toBe('book');
  expect(list.getAllByRole('listitem')[0]).toHaveTextContent(first.snippet);
  await userEvent.click(
    screen.getByRole('button', { name: /The first place/ })
  );
  expect(jump).toHaveBeenCalledExactlyOnceWith(first);
  expect(screen.getByText(/paragraph 2 · sentence 3/)).toHaveTextContent('10%');
});

test('a failed delete keeps its bookmark, announces failure and allows an explicit retry', async () => {
  let reject!: (error: Error) => void;
  const remove = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, fail) => {
          reject = fail;
        })
    )
    .mockResolvedValue(undefined);
  render(
    <BookmarkList
      bookmarks={[first]}
      progress={progress}
      onJump={vi.fn()}
      onDelete={remove}
    />
  );
  const button = screen.getByRole('button', { name: /^Delete bookmark/ });
  await userEvent.click(button);
  expect(button).toBeDisabled();
  await userEvent.click(button);
  expect(remove).toHaveBeenCalledTimes(1);
  await act(async () => reject(new Error('write failed')));
  expect(screen.getByRole('alert')).toHaveTextContent('It remains in the list');
  expect(screen.getByText(first.snippet)).toBeInTheDocument();
  expect(button).toBeEnabled();
  await userEvent.click(button);
  expect(remove).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a late delete failure cannot announce the previous owner’s operation after handover', async () => {
  let reject!: (error: Error) => void;
  const remove = vi.fn(
    () =>
      new Promise<void>((_resolve, fail) => {
        reject = fail;
      })
  );
  const view = render(
    <BookmarkList
      bookmarks={[first]}
      progress={progress}
      onJump={vi.fn()}
      onDelete={remove}
    />
  );
  await userEvent.click(
    screen.getByRole('button', { name: /^Delete bookmark/ })
  );
  act(() => invalidateDataScope());
  view.rerender(
    <BookmarkList
      bookmarks={[]}
      progress={new Map()}
      onJump={vi.fn()}
      onDelete={remove}
    />
  );
  await act(async () => reject(new Error('old owner')));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getByText(/No bookmarks yet/)).toBeInTheDocument();
});
