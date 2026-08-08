import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

test('dashboard renders the start-of-day CTA', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  expect(screen.getByText(/start the day/i)).toBeInTheDocument();
});
