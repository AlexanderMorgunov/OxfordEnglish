import { describe, expect, test } from 'vitest';
import {
  courseAttempt,
  courseDay,
  coursePack,
  courseUnit,
} from '@/test/courseFixture';
import { countLabel, courseModel, unitLevel } from './model';

describe('course progress and continuation', () => {
  const pack = coursePack();
  const work = (dayId: string) => ({ packId: pack.manifest.id, dayId });
  test('starts from placement without inventing progress or a working day', () => {
    const result = courseModel(pack, [], null, 'next');
    expect(result.candidate?.day.id).toBe('c');
    expect(result.explicit).toBe(false);
    expect([result.done, result.total]).toEqual([0, 3]);
    expect(courseModel(pack, [], null, 'removed').candidate?.day.id).toBe('a');
  });
  test('a wrong-only answer is in progress, unrelated exercises do not count', () => {
    const result = courseModel(
      pack,
      [
        courseAttempt('b.e1', false),
        courseAttempt('placement:a.e1'),
        courseAttempt('checkpoint:a.e2'),
      ],
      null,
      'next'
    );
    expect(result.candidate?.day.id).toBe('b');
    expect(result.byId.get('b')?.progress).toEqual({
      state: 'in-progress',
      completed: 0,
      total: 2,
    });
    expect(result.byId.get('a')?.progress.state).toBe('new');
  });
  test('duplicate and later incorrect answers cannot reduce or inflate solved counts', () => {
    const result = courseModel(
      pack,
      ['a.e1', 'a.e1', 'a.e2']
        .map((id) => courseAttempt(id))
        .concat(courseAttempt('a.e1', false)),
      work('a'),
      null
    );
    expect(result.byId.get('a')?.progress).toEqual({
      state: 'done',
      completed: 2,
      total: 2,
    });
    expect(result.candidate?.day.id).toBe('b');
    expect(result.explicit).toBe(false);
  });
  test('explicit work wins over other partials, but browsing is not work', () => {
    const attempts = [courseAttempt('a.e1'), courseAttempt('b.e2', false)];
    const result = courseModel(pack, attempts, work('c'), 'intro');
    expect(result.partials.map((entry) => entry.day.id)).toEqual(['a', 'b']);
    expect(result.candidate?.day.id).toBe('c');
    expect(result.explicit).toBe(true);
    expect(courseModel(pack, attempts, null, 'next').candidate?.day.id).toBe(
      'a'
    );
  });
  test('missing work or work from a different pack falls back safely', () => {
    expect(
      courseModel(pack, [], work('removed'), 'next').candidate?.day.id
    ).toBe('c');
    expect(
      courseModel(pack, [], { packId: 'other', dayId: 'b' }, 'next').candidate
        ?.day.id
    ).toBe('c');
  });
  test('finishing the last day offers an earlier unfinished day', () => {
    const result = courseModel(
      pack,
      [courseAttempt('c.e1'), courseAttempt('c.e2')],
      work('c'),
      'next'
    );
    expect(result.candidate?.day.id).toBe('a');
  });
  test('a completed course has no false continuation', () => {
    const attempts = ['a', 'b', 'c'].flatMap((id) => [
      courseAttempt(`${id}.e1`),
      courseAttempt(`${id}.e2`),
    ]);
    const result = courseModel(pack, attempts, work('c'), null);
    expect(result.allDone).toBe(true);
    expect(result.candidate).toBeUndefined();
    expect(result.groups.map((group) => [group.done, group.total])).toEqual([
      [2, 2],
      [1, 1],
    ]);
  });
  test('empty topics and unscored materials are never completed by 0/0', () => {
    const empty = courseModel(
      coursePack([courseUnit('empty', [])]),
      [],
      null,
      null
    );
    expect(empty.allDone).toBe(false);
    expect(empty.candidate).toBeUndefined();
    expect(empty.groups[0]).toMatchObject({ done: 0, total: 0 });
    const unscored = courseModel(
      coursePack([courseUnit('read', [courseDay('d', 'B1', false)])]),
      [],
      null,
      null
    );
    expect(unscored.candidate?.progress).toEqual({
      state: 'new',
      completed: 0,
      total: 0,
    });
    expect(unscored.allDone).toBe(false);
  });
  test('levels come from the pack, including missing and mixed levels', () => {
    const legacy = courseDay('legacy');
    delete legacy.level;
    expect(unitLevel(courseUnit('legacy', [legacy]), 'B1')).toBe('B1');
    expect(
      unitLevel(courseUnit('story', [courseDay('b1', 'B1'), legacy]), 'A2')
    ).toBe('B1');
    const result = courseModel(
      coursePack([
        courseUnit('advanced', [courseDay('c1', 'C1')]),
        courseUnit('mixed', [courseDay('a1'), courseDay('a2', 'A2')]),
      ]),
      [],
      null,
      null
    );
    expect(result.groups.map((group) => group.level)).toEqual(['C1', 'mixed']);
  });
  test('Russian counts use the correct plural forms', () => {
    expect([1, 2, 5, 11, 21].map((n) => countLabel(n, true, 'day'))).toEqual([
      '1 день',
      '2 дня',
      '5 дней',
      '11 дней',
      '21 день',
    ]);
  });
});
