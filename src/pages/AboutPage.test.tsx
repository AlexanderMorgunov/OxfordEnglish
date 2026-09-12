import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { AboutPage } from './AboutPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>
  );

test('landing shows the headline and a way into the app', () => {
  renderPage();
  expect(screen.getByRole('heading', { level: 1, name: /one day at a time/i })).toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /start for free|open the app/i }).length).toBeGreaterThan(0);
});

test('the word demo reveals the lookup card only after a tap', async () => {
  renderPage();
  expect(screen.queryByText(/past of/i)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^went/i }));
  expect(screen.getByText(/past of/i)).toBeInTheDocument();
  expect(screen.getByText(/go — went — gone/)).toBeInTheDocument();
});

test('the phrase demo builds a phrase from the first and last word', async () => {
  renderPage();
  await userEvent.click(screen.getByRole('button', { name: /^make$/i }));
  await userEvent.click(screen.getByRole('button', { name: /select phrase/i }));
  await userEvent.click(screen.getByRole('button', { name: /^mind$/i }));
  expect(screen.getByText(/make up her mind/i)).toBeInTheDocument();
  expect(screen.getByText(/to decide/i)).toBeInTheDocument();
});

test('the review demo hides the grades until the card is revealed', async () => {
  renderPage();
  expect(screen.queryByRole('group', { name: /grade/i })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /show the translation/i }));
  const grades = screen.getByRole('group', { name: /grade/i });
  await userEvent.click(screen.getByRole('button', { name: /^good$/i }));
  expect(grades).toBeInTheDocument();
  expect(screen.getByText(/next review: in 3 days/i)).toBeInTheDocument();
});
