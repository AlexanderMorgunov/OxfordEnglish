import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Day } from '../../../../src/content/schema.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACK_ROOT =
  process.env.PACK_ROOT ?? join(REPO_ROOT, 'public/packs/dev-english-a2');

const ATTRIBUTION_REQUIRED = new Set(['CC-BY', 'CC-BY-SA', 'public-domain']);

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

export function writeDay(
  dayJson: string,
  filename: string
): { written: string; note: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(dayJson);
  } catch (e) {
    throw new Error(`day is not valid JSON: ${(e as Error).message}`);
  }

  // Single source of truth: structure, media-license presence, and the
  // SkillTag registry are all enforced by the app's schema.
  const parsed = Day.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`day fails the pack schema:\n${parsed.error.message}`);
  }
  const day = parsed.data;

  const problems: string[] = [];
  walk(day, (node) => {
    if (typeof node.src === 'string' && node.license) {
      const license = node.license as { type?: string; attribution?: string };
      if (license.type === 'local-only') {
        problems.push(`media "${node.src}" is local-only — refused for the public pack`);
      } else if (
        typeof license.type === 'string' &&
        ATTRIBUTION_REQUIRED.has(license.type) &&
        !license.attribution
      ) {
        problems.push(`media "${node.src}" (${license.type}) requires attribution`);
      }
    }
  });
  if (problems.length) {
    throw new Error(`refusing to write:\n${problems.map((p) => '  - ' + p).join('\n')}`);
  }

  const target = join(PACK_ROOT, 'days', filename);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, JSON.stringify(day, null, 2) + '\n');

  return {
    written: target,
    note: 'run pack_validate (npm run validate:packs) before committing',
  };
}
