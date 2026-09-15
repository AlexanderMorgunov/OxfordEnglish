import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The grammar lens runs on the user's own key (client, `functions.ts`) or on ours (server,
 * `aiPrompts.ts`), and the prompt is duplicated verbatim in both. Nothing has ever checked that,
 * so the two can silently drift and the same sentence gets different answers depending on which
 * path the user is on — a difference nobody would think to look for.
 *
 * Compared as SOURCE TEXT rather than by importing both: the server module is a separate tsconfig
 * with `.js` import specifiers and cannot be pulled into this test. Coarser than an import, but it
 * guards the invariant that actually matters, and it fails loudly the moment someone edits one copy.
 */

const ROOT = join(__dirname, '..', '..', '..');
const CLIENT = readFileSync(join(ROOT, 'src', 'features', 'ai', 'functions.ts'), 'utf8');
const SERVER = readFileSync(join(ROOT, 'server', 'src', 'aiPrompts.ts'), 'utf8');

/** The rule list inside `grammarSystem` — from the "Правила:" line to the closing `].join`. */
function rules(src: string): string[] {
  const start = src.indexOf("'Правила:',", src.indexOf('function grammarSystem'));
  const end = src.indexOf("].join('\\n')", start);
  expect(start, 'grammarSystem rules block not found').toBeGreaterThan(-1);
  expect(end, 'end of the rules block not found').toBeGreaterThan(start);
  return src
    .slice(start, end)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith("'") || l.startsWith('`'));
}

/** The few-shot pairs, matched on their literal `src:` / `out:` values. */
function shots(src: string): string[] {
  const block = src.slice(src.indexOf('GRAMMAR_SHOTS'), src.indexOf('function grammarSystem'));
  return [...block.matchAll(/^\s*(src|out):\s*(['"`])([\s\S]*?)\2,\s*$/gm)].map((m) => m[3] ?? '');
}

describe('grammar prompt parity between the managed and BYOK paths', () => {
  it('the system rules are identical', () => {
    const c = rules(CLIENT);
    expect(c.length).toBeGreaterThan(3); // the extractor found something real
    expect(c).toEqual(rules(SERVER));
  });

  it('the few-shot examples are identical', () => {
    const c = shots(CLIENT);
    expect(c.length).toBe(4); // two shots × (src + out)
    expect(c).toEqual(shots(SERVER));
  });

  // The long-sentence shot is the whole point of the change: one short example taught the model to
  // answer in that shape whatever the input, which is how a 60-word period came back explained as if
  // it were simple.
  it('carries a multi-clause example, not just a short one', () => {
    const longest = shots(CLIENT)
      .map((s) => s.split(/\s+/).length)
      .sort((a, b) => b - a)[0];
    expect(longest).toBeGreaterThan(20);
  });
});
