import 'fake-indexeddb/auto';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';
import { useContentStore } from '@/content/store';
import { useLearner } from '@/features/learner/store';
import {
  courseAttempt,
  courseDay,
  coursePack,
  courseUnit,
} from '@/test/courseFixture';
import { DashboardPage } from '@/pages/DashboardPage';
import { CourseOverviewPage } from '@/pages/CourseOverviewPage';
import { DayPage } from '@/pages/DayPage';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useCourseNavigation } from './navigation';
import { useCourseProgress } from './useCourseProgress';

vi.mock('./useCourseProgress', () => ({ useCourseProgress: vi.fn() }));

const pack = coursePack();
const read = vi.mocked(useCourseProgress);
const ready = {
  status: 'ready' as const,
  attempts: [],
  due: 0,
  retry: vi.fn(),
};
function App({ start = '/' }: { start?: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/syllabus" element={<CourseOverviewPage />} />
        <Route path="/course/:unitId/day/:dayId" element={<DayPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  useCourseNavigation.getState().reset();
  useLearner.setState({
    level: null,
    placementDone: true,
    recommendedUnitId: 'intro',
  });
  useContentStore.setState({
    pack,
    status: 'ready',
    error: null,
    load: vi.fn(async () => undefined),
  });
  read.mockReturnValue({ ...ready });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
});

test('waits for stored answers before choosing the initial topic', async () => {
  read.mockReturnValue({ ...ready, status: 'loading' });
  const view = render(<App />);
  expect(screen.getByText('Loading course and progress…')).toBeInTheDocument();
  expect(useCourseNavigation.getState().viewedUnitId).toBeNull();
  read.mockReturnValue({ ...ready, attempts: [courseAttempt('c.e1', false)] });
  view.rerender(<App />);
  expect(
    await screen.findByRole('heading', { name: 'Topic next' })
  ).toBeInTheDocument();
  expect(useCourseNavigation.getState().work).toBeNull();
});

test('levels open independently, can all close, and locate preserves other levels', async () => {
  useCourseNavigation.getState().openDay(pack.manifest.id, 'next', 'c');
  render(<App start="/syllabus" />);
  const a1 = screen.getByRole('button', { name: /A1 First steps/ });
  const a2 = screen.getByRole('button', { name: /A2 Everyday/ });
  expect(a1).toHaveAttribute('aria-expanded', 'false');
  expect(a2).toHaveAttribute('aria-expanded', 'true');
  fireEvent.click(a1);
  fireEvent.click(a2);
  fireEvent.click(a1);
  expect(a1).toHaveAttribute('aria-expanded', 'false');
  expect(a2).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(a1);
  fireEvent.click(screen.getByRole('button', { name: 'Locate working topic' }));
  expect(a1).toHaveAttribute('aria-expanded', 'true');
  expect(a2).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() =>
    expect(screen.getByRole('link', { name: /Topic next/ })).toHaveFocus()
  );
});

test('topic browsing and mobile preview do not replace work; returning keeps disclosures', async () => {
  useCourseNavigation.getState().openDay(pack.manifest.id, 'intro', 'a');
  render(<App start="/syllabus" />);
  fireEvent.click(screen.getByRole('button', { name: /A2 Everyday/ }));
  fireEvent.click(screen.getByRole('link', { name: /Topic next/ }));
  const day = screen.getByRole('button', { name: /Day 1\s*Day c/ });
  fireEvent.click(day);
  const dialog = screen.getByRole('dialog', { name: 'Day overview' });
  expect(
    within(dialog).getByRole('heading', { name: 'Day c' })
  ).toBeInTheDocument();
  expect(useCourseNavigation.getState().work?.dayId).toBe('a');
  fireEvent.click(
    within(dialog).getByRole('button', { name: 'Close day overview' })
  );
  expect(day).toHaveFocus();
  fireEvent.click(screen.getByRole('link', { name: /Full course/ }));
  expect(
    screen.getByRole('button', { name: /A1 First steps/ })
  ).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: /A2 Everyday/ })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  expect(screen.getByRole('link', { name: 'Continue day' })).toHaveAttribute(
    'href',
    '/course/intro/day/a'
  );
});

test('opening a real lesson sets work; a mismatched unit/day link does not', async () => {
  const view = render(<App start="/course/next/day/c" />);
  expect(
    await screen.findByRole('heading', { name: 'Day c', level: 1 })
  ).toBeInTheDocument();
  expect(useCourseNavigation.getState().work?.dayId).toBe('c');
  view.unmount();
  render(<App start="/course/intro/day/c" />);
  expect(
    screen.getByRole('heading', { name: 'Day not found' })
  ).toBeInTheDocument();
  expect(useCourseNavigation.getState().work?.dayId).toBe('c');
});

test('desktop active day opens immediately; selecting another day previews it before opening', async () => {
  const match = window.matchMedia;
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...match(query),
    matches: query === '(min-width: 960px)',
  }));
  try {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: /Open day:.*Day a/ }));
    expect(
      await screen.findByRole('heading', { name: 'Day a', level: 1 })
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: /Back to topic days/ }));
    fireEvent.click(screen.getByRole('button', { name: /Day 2\s*Day b/ }));
    expect(
      screen.getByRole('heading', { name: 'Today', level: 1 })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: 'Day b', level: 3 })
    ).toBeInTheDocument();
    expect(useCourseNavigation.getState().work?.dayId).toBe('a');
    const selected = screen.getByRole('link', { name: /Open day:.*Day b/ });
    expect(selected).toHaveFocus();
    fireEvent.click(selected);
    expect(
      await screen.findByRole('heading', { name: 'Day b', level: 1 })
    ).toBeInTheDocument();
    expect(useCourseNavigation.getState().work?.dayId).toBe('b');
  } finally {
    media.mockRestore();
  }
});

test('desktop completed day remains openable and keeps the reader return context', () => {
  const match = window.matchMedia;
  const media = vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    ...match(query),
    matches: query === '(min-width: 960px)',
  }));
  read.mockReturnValue({
    ...ready,
    attempts: [courseAttempt('a.e1'), courseAttempt('a.e2')],
  });
  try {
    render(<App start="/?unit=intro&from=reader" />);
    fireEvent.click(screen.getByRole('button', { name: /Day 1\s*Day a/ }));
    expect(
      screen.getByRole('link', { name: /Open day:.*Day a.*Completed/ })
    ).toHaveAttribute('href', '/course/intro/day/a?from=reader');
  } finally {
    media.mockRestore();
  }
});

test('reader return context survives the course overview, preview and lesson', async () => {
  render(<App start="/syllabus?from=reader" />);
  fireEvent.click(screen.getByRole('link', { name: /Topic intro/ }));
  expect(
    screen.getByRole('button', { name: /back to reading/ })
  ).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /Day 1\s*Day a/ }));
  const open = within(screen.getByRole('dialog')).getByRole('link', {
    name: 'Open selected day',
  });
  expect(open).toHaveAttribute('href', '/course/intro/day/a?from=reader');
  fireEvent.click(open);
  const back = await screen.findByRole('link', { name: /Back to topic days/ });
  expect(back).toHaveAttribute('href', '/?unit=intro&from=reader');
  fireEvent.click(back);
  expect(
    screen.getByRole('button', { name: /back to reading/ })
  ).toBeInTheDocument();
});

test('multiple partial days offer a choice and never start another day silently', () => {
  read.mockReturnValue({
    ...ready,
    attempts: [courseAttempt('b.e1', false), courseAttempt('c.e1')],
  });
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: 'Choose a day' }));
  const choices = screen.getByRole('dialog', {
    name: 'What will you continue?',
  });
  expect(within(choices).getAllByRole('button').length).toBe(3);
  fireEvent.click(within(choices).getByRole('button', { name: /Day c/ }));
  expect(useCourseNavigation.getState().work?.dayId).toBe('c');
  expect(
    screen.getByRole('heading', { name: 'Topic next' })
  ).toBeInTheDocument();
});

test('storage failure keeps lessons available without showing false zero counts', () => {
  const retry = vi.fn();
  read.mockReturnValue({ ...ready, status: 'error', retry });
  render(<App start="/?unit=missing" />);
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Saved answers have not been deleted'
  );
  expect(screen.queryByText(/0 of 3 course days/)).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Start day' })).toHaveAttribute(
    'href',
    '/course/intro/day/a'
  );
  expect(screen.getByText(/linked topic is unavailable/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry progress' }));
  expect(retry).toHaveBeenCalledOnce();
});

test('empty topics have no navigation trap or false completed state', () => {
  useContentStore.setState({
    pack: coursePack([
      courseUnit('empty', []),
      courseUnit('read', [courseDay('r', 'A2', false)]),
    ]),
  });
  render(<App start="/syllabus" />);
  fireEvent.click(screen.getByRole('button', { name: /A1 First steps/ }));
  expect(screen.getByText('Days coming later')).toBeVisible();
  expect(
    screen.queryByRole('link', { name: /Topic empty/ })
  ).not.toBeInTheDocument();
  expect(
    screen.queryByText('Every course day is complete')
  ).not.toBeInTheDocument();
});

test('account handover closes a preview and clears the previous working day', () => {
  useCourseNavigation.getState().openDay(pack.manifest.id, 'next', 'c');
  render(<App />);
  fireEvent.click(screen.getByRole('button', { name: /Day 1\s*Day c/ }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  act(() => invalidateDataScope('reset'));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(useCourseNavigation.getState().work).toBeNull();
});
