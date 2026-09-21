import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

test('dashboard renders the hero heading', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  // `\s*` because the amber half sits in its own span, and the accessibility tree puts a space at that
  // element boundary: the text reads "DayEnglish" but the accessible name is "Day English".
  expect(screen.getByRole('heading', { name: /day\s*english/i })).toBeInTheDocument();
});
