import { beforeEach, expect, test, vi } from 'vitest';
import { invalidateDataScope } from '@/features/account/dataScope';
import { useCourseNavigation } from './navigation';

beforeEach(() => useCourseNavigation.getState().reset());

test('browsing and previewing preserve explicit work and stored work', () => {
  const nav = useCourseNavigation.getState();
  nav.openDay('pack', 'intro', 'a');
  nav.viewUnit('next');
  nav.selectDay('next', 'c');
  nav.setExpanded(['A1', 'B2']);
  expect(useCourseNavigation.getState()).toMatchObject({
    work: { packId: 'pack', dayId: 'a' },
    viewedUnitId: 'next',
    selected: { intro: 'a', next: 'c' },
  });
  expect(JSON.parse(localStorage.getItem('oxford-course-work')!)).toEqual({
    packId: 'pack',
    dayId: 'a',
  });
});

test('a pack change clears browsing snapshots without attributing work to another pack', () => {
  const nav = useCourseNavigation.getState();
  nav.openDay('old', 'intro', 'a');
  nav.setExpanded([]);
  nav.remember('old', { scroll: 800, focus: 'a' });
  nav.prepare('new');
  expect(useCourseNavigation.getState()).toMatchObject({
    packId: 'new',
    work: { packId: 'old', dayId: 'a' },
    viewedUnitId: null,
    selected: {},
    positions: {},
    expanded: null,
  });
});

test('anonymous adoption keeps course context; account handover erases it', () => {
  useCourseNavigation.getState().openDay('pack', 'intro', 'a');
  invalidateDataScope('adopt-anonymous');
  expect(useCourseNavigation.getState().work?.dayId).toBe('a');
  invalidateDataScope('reset');
  expect(useCourseNavigation.getState()).toMatchObject({
    work: null,
    viewedUnitId: null,
    selected: {},
    expanded: null,
    positions: {},
  });
  expect(localStorage.getItem('oxford-course-work')).toBeNull();
});

test('unavailable storage still allows opening and changing days for this session', () => {
  const write = vi
    .spyOn(Storage.prototype, 'setItem')
    .mockImplementation(() => {
      throw new Error('Quota');
    });
  try {
    expect(() =>
      useCourseNavigation.getState().openDay('pack', 'intro', 'a')
    ).not.toThrow();
    expect(useCourseNavigation.getState().work?.dayId).toBe('a');
  } finally {
    write.mockRestore();
  }
});
