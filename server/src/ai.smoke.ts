/**
 * Pure-core checks for the managed-AI domain. Run: `npx tsx src/ai.smoke.ts`.
 * The key property: identical work must produce an identical cache key (or the cross-user cache never
 * hits and the whole economic argument for it collapses), while anything that changes the OUTPUT — task,
 * prompt version, model, inputs — must produce a different one.
 */
import { cacheKey, inputSize, buildMessages, TASKS, AI_COST_PER_CALL } from './ai.js';
import type { AiTaskRequest } from './contract.js';

let failures = 0;
const check = (name: string, cond: boolean) => {
  console.log(`${cond ? '✓' : '✗'} ${name}`);
  if (!cond) failures += 1;
};

const M = 'deepseek-v4-flash';
const base: AiTaskRequest = { task: 'translate', text: 'the harpoon' };

check('same request → same key', cacheKey(base, M) === cacheKey({ ...base }, M));
check('surrounding whitespace is normalized away', cacheKey({ task: 'translate', text: '  the harpoon ' }, M) === cacheKey(base, M));
check('field order does not matter', (() => {
  const a: AiTaskRequest = { task: 'translate', text: 'x', sentence: 'y' };
  const b: AiTaskRequest = { sentence: 'y', text: 'x', task: 'translate' } as AiTaskRequest;
  return cacheKey(a, M) === cacheKey(b, M);
})());
check('different input → different key', cacheKey({ task: 'translate', text: 'the anchor' }, M) !== cacheKey(base, M));
check('context changes the key (fragment means something else)', cacheKey({ task: 'translate', text: 'the harpoon', sentence: 'He seized the harpoon.' }, M) !== cacheKey(base, M));
check('different model → different key', cacheKey(base, 'other-model') !== cacheKey(base, M));
check('different task with the same text → different key', cacheKey({ task: 'grammar', sentence: 'the harpoon' }, M) !== cacheKey({ task: 'simplify', sentence: 'the harpoon' }, M));
check('key is url-safe (it becomes a primary key)', /^[A-Za-z0-9_-]+$/.test(cacheKey(base, M)));

// simplify: the band is derived, so two levels that clamp to the same band must share a key.
check('C1 and B2 clamp to the same band → same key', cacheKey({ task: 'simplify', sentence: 's', level: 'C1' }, M) === cacheKey({ task: 'simplify', sentence: 's', level: 'B2' }, M));
check('a different band → different key', cacheKey({ task: 'simplify', sentence: 's', level: 'A1' }, M) !== cacheKey({ task: 'simplify', sentence: 's', level: 'B1' }, M));

check('inputSize counts strings', inputSize({ task: 'translate', text: 'abcde' }) === 5);
check('inputSize counts array members', inputSize({ task: 'exercises', text: 'ab', targets: ['cd', 'e'] }) === 5);
check('inputSize ignores the task name itself', inputSize({ task: 'hint', prompt: 'ab', topic: 'cd' }) === 4);

check('hint is never cached (must react to the current answer)', TASKS.hint.cacheable === false);
check('bookqa is never cached (questions vary)', TASKS.bookqa.cacheable === false);
check('translate/simplify/grammar are cached', TASKS.translate.cacheable && TASKS.simplify.cacheable && TASKS.grammar.cacheable);
check('every task caps its output', Object.values(TASKS).every((t) => t.maxTokens > 0 && t.maxTokens <= 700));
check('a cache hit still costs the same as a miss', AI_COST_PER_CALL === 1);

const msgs = buildMessages({ task: 'simplify', sentence: 'Having finished, he left.', level: 'A2' });
check('simplify builds system + few-shot + user', msgs.length === 4 && msgs[0]?.role === 'system' && msgs[2]?.role === 'assistant');
check('the band reaches the system prompt', msgs[0]!.content.includes('CEFR level A2'));
check('translate without context sends the bare text', (() => {
  const m = buildMessages(base);
  return m.length === 2 && m[1]?.content === 'the harpoon';
})());
check('bookqa puts the page in the constant system prefix', (() => {
  const m = buildMessages({ task: 'bookqa', pageText: 'PAGE', question: 'why?' });
  return m[0]!.content.includes('PAGE') && m[1]!.content === 'why?';
})());

console.log(failures === 0 ? '\nai core: all checks passed' : `\nai core: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
