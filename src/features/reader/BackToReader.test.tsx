import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import type * as ReactRouter from 'react-router-dom';
import { BackToReader } from './BackToReader';
import { rememberReader } from './return-to-reader';

// The component's whole job is deciding WHERE to send the reader back to; asserting the navigate
// argument tests that directly, without depending on a test router actually rendering the target.
const navigate = vi.fn();
vi.mock('react-router-dom', async () => ({
  ...(await vi.importActual<typeof ReactRouter>('react-router-dom')),
  useNavigate: () => navigate,
}));

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <BackToReader />
    </MemoryRouter>
  );

const backButton = () => screen.getByRole('button', { name: /back to reading/i });

beforeEach(() => {
  navigate.mockClear();
  localStorage.removeItem('reader.lastPath');
});

test('stays hidden for a page opened from the normal nav', () => {
  renderAt('/vocabulary');
  expect(screen.queryByRole('button', { name: /back to reading/i })).not.toBeInTheDocument();
});

test('returns to the remembered book page, not one step back in history', async () => {
  rememberReader('/library/catalog/alice');
  renderAt('/vocabulary?from=reader');
  await userEvent.click(backButton());
  expect(navigate).toHaveBeenCalledWith('/library/catalog/alice');
});

test('falls back to history when no book page was remembered', async () => {
  renderAt('/vocabulary?from=reader');
  await userEvent.click(backButton());
  expect(navigate).toHaveBeenCalledWith(-1);
});

test('ignores a remembered path that is not a reader route', async () => {
  rememberReader('/settings');
  renderAt('/vocabulary?from=reader');
  await userEvent.click(backButton());
  expect(navigate).toHaveBeenCalledWith(-1);
});
