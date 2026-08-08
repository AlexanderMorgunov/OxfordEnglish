import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tatoebaSearch } from '../src/lib/tatoeba.ts';
import { dictLookup } from '../src/lib/dictionary.ts';
import { levelCheck } from '../src/lib/level.ts';
import { writeDay } from '../src/lib/writer.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const DAY_ID = 'u01.d03';
const FILE = `${DAY_ID}.json`;

// 1. Pull licensed sentences from Tatoeba (level-gated).
const { sentences } = tatoebaSearch({
  maxNgslRank: 2600,
  requireRussian: true,
  maxWords: 10,
  limit: 6,
});
if (sentences.length < 4) throw new Error('not enough sample sentences — run "npm run import:tatoeba -- --sample"');

// 2. Glossary IPA from the local dictionary.
const glossary = ['deploy', 'merge', 'revert']
  .map((w) => dictLookup(w))
  .filter((e): e is NonNullable<typeof e> => Boolean(e))
  .map((e) => ({ word: e.word, ipa: e.ipa }));

const readingText =
  'Yesterday was a normal work day. I fixed a bug, wrote a test, and my teammate ' +
  'reviewed the pull request. We merged the branch and went home.';

// 3. Assemble the day (original prose = pack license "original"; sentences carry CC-BY).
const day = {
  id: DAY_ID,
  title: { en: 'Past Simple at work', ru: 'Past Simple на работе' },
  estimatedMinutes: 25,
  tags: ['grammar.past-simple', 'vocab.dev'],
  sections: [
    {
      type: 'grammar',
      id: `${DAY_ID}.grammar`,
      title: { en: 'Talking about a finished day', ru: 'Рассказываем о завершённом дне' },
      rule: {
        en: 'Use the Past Simple to report what happened — finished actions at a known time.',
        ru: 'Past Simple — чтобы рассказать, что произошло: завершённые действия в известное время.',
      },
      patterns: [
        {
          label: { en: 'Statement', ru: 'Утверждение' },
          formula: 'subject + past verb',
          examples: [{ en: 'We merged the branch.', ru: 'Мы влили ветку.' }],
        },
      ],
    },
    {
      type: 'reading',
      id: `${DAY_ID}.reading`,
      title: { en: 'A normal day', ru: 'Обычный день' },
      blocks: [{ id: `${DAY_ID}.reading.b1`, en: readingText }],
      glossary,
    },
    {
      type: 'practice',
      id: `${DAY_ID}.practice`,
      title: { en: 'Practice', ru: 'Практика' },
      exercises: sentences.slice(0, 4).map((s, i) => ({
        type: 'translate' as const,
        id: `${DAY_ID}.ex.tr.${String(i + 1).padStart(2, '0')}`,
        instruction: { en: 'Translate into English.', ru: 'Переведи на английский.' },
        tags: ['writing.translation', 'grammar.past-simple'],
        direction: 'ru-en' as const,
        prompt: s.ru!,
        answers: [s.en],
      })),
    },
  ],
};

// 4. Level report (informational — dev vocab is intentionally above pure-A2 frequency).
const report = levelCheck(readingText, 1500);
console.log(`level_check: ${report.verdict} (offenders: ${report.offenders.map((o) => o.word).join(', ') || 'none'})`);

// 5. Write via the enforcing writer.
const result = writeDay(JSON.stringify(day), FILE);
console.log(`✓ ${result.written}`);

// 6. Register the day in course.json (else validate:packs flags an orphan file).
const coursePath = join(REPO_ROOT, 'public/packs/dev-english-a2/course.json');
const course = JSON.parse(readFileSync(coursePath, 'utf8'));
const unit = course.units.find((u: { id: string }) => u.id === 'u01');
if (unit && !unit.dayIds.includes(DAY_ID)) {
  unit.dayIds.push(DAY_ID);
  writeFileSync(coursePath, JSON.stringify(course, null, 2) + '\n');
  console.log(`✓ registered ${DAY_ID} in course.json`);
}

// 7. Prove the whole pack still validates.
const v = spawnSync('npm', ['run', 'validate:packs'], {
  cwd: REPO_ROOT,
  encoding: 'utf8',
  shell: process.platform === 'win32',
});
console.log(v.stdout?.trim() || v.stderr?.trim());
process.exit(v.status ?? 0);
