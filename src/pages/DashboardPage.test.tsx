import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { DashboardPage } from './DashboardPage';

test('dashboard renders Today while the course loads', () => {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>
  );
  expect(screen.getByRole('heading', { name: 'Today', level: 1 })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /full course/i })).toHaveAttribute('href', '/syllabus');
});
