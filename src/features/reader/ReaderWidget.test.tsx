import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { ReaderWidget } from './ReaderWidget';

const renderWidget = () =>
  render(
    <MemoryRouter>
      <ReaderWidget
        onBookmarkHere={() => Promise.resolve({ added: true })}
        bookmarks={[]}
        progress={new Map()}
        onJump={() => undefined}
        onDelete={() => undefined}
      />
    </MemoryRouter>
  );

const openPanel = async () => {
  await userEvent.click(screen.getByRole('button', { name: /quick actions/i }));
};

test('the panel is closed until the trigger is pressed', async () => {
  renderWidget();
  const trigger = screen.getByRole('button', { name: /quick actions/i });
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('navigation', { name: /sections/i })).not.toBeInTheDocument();
  await openPanel();
  expect(trigger).toHaveAttribute('aria-expanded', 'true');
});

test('icon-only section links keep an accessible name and the right target', async () => {
  renderWidget();
  await openPanel();
  const expected: [RegExp, string][] = [
    [/vocabulary/i, '/vocabulary?from=reader'],
    [/today/i, '/'],
    [/grammar/i, '/grammar'],
    [/review/i, '/review'],
    [/library/i, '/library'],
  ];
  for (const [name, href] of expected) {
    expect(screen.getByRole('link', { name })).toHaveAttribute('href', href);
  }
  expect(screen.getAllByRole('link')).toHaveLength(expected.length);
});
