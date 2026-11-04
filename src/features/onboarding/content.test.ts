import { expect, test } from 'vitest';
import { tourFor } from './content';
const routes = [
  '/',
  '/syllabus',
  '/course/u00/day/u00.d01',
  '/course/u02/day/u02.d90',
  '/library/catalog',
  '/library/catalog/alice-b1',
  '/library/synthetic-other-book',
  '/vocabulary',
  '/vocabulary/text',
  '/grammar',
  '/grammar/articles',
  '/review',
  '/progress',
  '/settings',
  '/settings/interface',
  '/settings/learning',
  '/settings/ai',
  '/settings/account',
  '/settings/data',
  '/settings/privacy',
  '/pro',
  '/about',
  '/feedback',
  '/placement',
  '/checkpoint/u00',
  '/account/register',
  '/support',
  '/credits',
  '/privacy',
  '/terms',
];
test.each(routes)(
  '%s has localized help with no prototype-only account restrictions',
  (path) => {
    for (const lang of ['ru', 'en'] as const) {
      const tour = tourFor(path, lang);
      expect(tour).not.toBeNull();
      expect(tour!.steps.length).toBeGreaterThan(0);
      const text = [
        tour!.title,
        ...tour!.steps.flatMap((step) => [step.title, step.body]),
      ].join(' ');
      if (lang === 'en') expect(text).not.toMatch(/[А-Яа-яЁё]/);
      expect(text).not.toMatch(
        /в этом прототипе|в демо|сервис заблокирован|серверные действия здесь отключены/i
      );
    }
  }
);
test('only real reader and lesson routes opt into automatic help', () => {
  expect(routes.filter((path) => tourFor(path, 'en')?.auto)).toEqual([
    '/course/u00/day/u00.d01',
    '/course/u02/day/u02.d90',
    '/library/catalog/alice-b1',
    '/library/synthetic-other-book',
  ]);
  expect(tourFor('/not-found', 'en')).toBeNull();
});
