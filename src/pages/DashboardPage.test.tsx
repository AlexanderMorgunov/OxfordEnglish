import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

test('dashboard renders the hero heading', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: /english for developers/i })).toBeInTheDocument();
});
