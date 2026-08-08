import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Day } from '../../../../src/content/schema.ts';
import { politeFetch } from './net.ts';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const PACK_ROOT =
  process.env.PACK_ROOT ?? join(REPO_ROOT, 'public/packs/dev-english-a2');

const ATTRIBUTION_REQUIRED = new Set(['CC-BY', 'CC-BY-SA', 'public-domain']);
const AUDIO_EXT = new Set(['.mp3', '.ogg', '.wav', '.m4a']);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.svg', '.webp', '.gif']);

function walk(node: unknown, visit: (n: Record<string, unknown>) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (node && typeof node === 'object') {
    visit(node as Record<string, unknown>);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

/** Download any http(s) media into the pack and rewrite src to the local path. */
async function localizeMedia(root: unknown): Promise<void> {
  const jobs: Promise<void>[] = [];
  walk(root, (node) => {
    const src = node.src;
    if (typeof src !== 'string' || !/^https?:\/\//.test(src)) return;
    const ext = (extname(new URL(src).pathname) || '.bin').toLowerCase();
    const sub = AUDIO_EXT.has(ext) ? 'audio' : IMAGE_EXT.has(ext) ? 'images' : 'files';
    const name = createHash('sha256').update(src).digest('hex').slice(0, 16) + ext;
    const rel = `media/${sub}/${name}`;
    const abs = join(PACK_ROOT, rel);
    node.src = rel;
    if (existsSync(abs)) return;
    jobs.push(
      (async () => {
        const res = await politeFetch(src);
        if (!res.ok) throw new Error(`media download failed (${res.status}): ${src}`);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, Buffer.from(await res.arrayBuffer()));
      })()
    );
  });
  await Promise.all(jobs);
}

function registerInCourse(dayId: string): boolean {
  const unitId = dayId.split('.')[0];
  const coursePath = join(PACK_ROOT, 'course.json');
  const course = JSON.parse(readFileSync(coursePath, 'utf8')) as {
    units: { id: string; dayIds: string[] }[];
  };
  const unit = course.units.find((u) => u.id === unitId);
  if (!unit) throw new Error(`no unit "${unitId}" in course.json to register "${dayId}"`);
  if (unit.dayIds.includes(dayId)) return false;
  unit.dayIds.push(dayId);
  writeFileSync(coursePath, JSON.stringify(course, null, 2) + '\n');
  return true;
}

export async function writeDay(
  dayJson: string,
  filename: string
): Promise<{ written: string; registered: boolean; note: string }> {
  let raw: unknown;
  try {
    raw = JSON.parse(dayJson);
  } catch (e) {
    throw new Error(`day is not valid JSON: ${(e as Error).message}`);
  }

  // Structure, media-license presence, and the SkillTag registry are all
  // enforced by the app schema — the single source of truth.
  const check = Day.safeParse(raw);
  if (!check.success) {
    throw new Error(`day fails the pack schema:\n${check.error.message}`);
  }

  await localizeMedia(raw); // remote media → local pack paths (mutates src)

  const problems: string[] = [];
  walk(raw, (node) => {
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
  writeFileSync(target, JSON.stringify(raw, null, 2) + '\n');

  const registered = registerInCourse((raw as { id: string }).id);
  return {
    written: target,
    registered,
    note: 'run pack_validate (npm run validate:packs) before committing',
  };
}
