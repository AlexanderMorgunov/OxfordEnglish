import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CourseIndex, Day, PackManifest, SkillTag } from './schema';

const PACK = join(process.cwd(), 'public', 'packs', 'dev-english-a2');
const readJson = (p: string) => JSON.parse(readFileSync(join(PACK, p), 'utf-8'));

test('demo pack manifest and course parse against the schema', () => {
  expect(() => PackManifest.parse(readJson('manifest.json'))).not.toThrow();
  expect(() => CourseIndex.parse(readJson('course.json'))).not.toThrow();
});

test('every referenced day file parses', () => {
  const course = CourseIndex.parse(readJson('course.json'));
  for (const id of course.units.flatMap((u) => u.dayIds)) {
    const parsed = Day.parse(readJson(`days/${id}.json`));
    expect(parsed.id).toBe(id);
  }
});

test('SkillTag rejects tags outside the registry', () => {
  expect(SkillTag.safeParse('grammar.past-simple').success).toBe(true);
  expect(SkillTag.safeParse('grammar.not-a-real-tag').success).toBe(false);
});

test('discriminated exercise union keeps type-specific fields', () => {
  const day = Day.parse(readJson('days/u01.d01.json'));
  const practice = day.sections.find((s) => s.type === 'practice');
  expect(practice?.type).toBe('practice');
  if (practice?.type === 'practice') {
    const gap = practice.exercises.find((e) => e.type === 'gap-fill');
    expect(gap?.type).toBe('gap-fill');
    if (gap?.type === 'gap-fill') expect(gap.answers.length).toBeGreaterThan(0);
  }
});
