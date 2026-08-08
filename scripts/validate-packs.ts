import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CourseIndex, Day, PackManifest } from '../src/content/schema';
import { SKILL_TAGS } from '../src/content/skill-tags';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PACK_ROOTS = [join(ROOT, 'public', 'packs'), join(ROOT, 'packs')];

const LICENSE_TYPES = new Set([
  'CC0',
  'CC-BY',
  'CC-BY-SA',
  'public-domain',
  'original',
  'local-only',
]);

type Problem = { pack: string; message: string };

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(file, 'utf-8'));
}

function findPackDirs(): string[] {
  const dirs: string[] = [];
  for (const root of PACK_ROOTS) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      const dir = join(root, name);
      if (statSync(dir).isDirectory() && existsSync(join(dir, 'manifest.json'))) {
        dirs.push(dir);
      }
    }
  }
  return dirs;
}

function isLicense(v: unknown): v is { type: string; attribution?: string } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { type?: unknown }).type === 'string' &&
    LICENSE_TYPES.has((v as { type: string }).type)
  );
}

function isMediaRef(v: unknown): v is { src: string; license: unknown } {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as { src?: unknown }).src === 'string' &&
    'license' in (v as object)
  );
}

function walk(node: unknown, visit: (n: unknown) => void): void {
  visit(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (typeof node === 'object' && node !== null) {
    for (const value of Object.values(node)) walk(value, visit);
  }
}

function validatePack(dir: string, problems: Problem[]): void {
  const rel = dir.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  const fail = (message: string) => problems.push({ pack: rel, message });

  const manifestResult = PackManifest.safeParse(readJson(join(dir, 'manifest.json')));
  if (!manifestResult.success) {
    fail(`manifest.json invalid:\n${manifestResult.error.message}`);
    return;
  }
  const manifest = manifestResult.data;
  const isPublic = manifest.visibility === 'public';

  const courseResult = CourseIndex.safeParse(readJson(join(dir, 'course.json')));
  if (!courseResult.success) {
    fail(`course.json invalid:\n${courseResult.error.message}`);
    return;
  }
  const course = courseResult.data;

  const ids = new Set<string>();
  const addId = (id: string, where: string) => {
    if (ids.has(id)) fail(`duplicate id "${id}" (in ${where})`);
    ids.add(id);
  };
  addId(course.id, 'course');
  for (const unit of course.units) addId(unit.id, 'unit');

  const referenced = course.units.flatMap((u) => u.dayIds);
  const dayFiles = existsSync(join(dir, 'days'))
    ? readdirSync(join(dir, 'days')).filter((f) => f.endsWith('.json'))
    : [];
  const onDisk = new Set(dayFiles.map((f) => f.replace(/\.json$/, '')));

  for (const id of referenced) {
    if (!onDisk.has(id)) fail(`unit references missing day file days/${id}.json`);
  }
  for (const id of onDisk) {
    if (!referenced.includes(id)) fail(`orphan day file days/${id}.json (not referenced)`);
  }

  const days: Day[] = [];
  for (const id of referenced) {
    if (!onDisk.has(id)) continue;
    const result = Day.safeParse(readJson(join(dir, 'days', `${id}.json`)));
    if (!result.success) {
      fail(`days/${id}.json invalid:\n${result.error.message}`);
      continue;
    }
    if (result.data.id !== id) fail(`days/${id}.json has mismatched id "${result.data.id}"`);
    days.push(result.data);
  }

  for (const day of days) {
    addId(day.id, 'day');
    walk(day, (node) => {
      if (typeof node === 'object' && node !== null && 'id' in node) {
        const id = (node as { id?: unknown }).id;
        if (typeof id === 'string' && id !== day.id) addId(id, `day ${day.id}`);
      }
    });
  }

  const roots: unknown[] = [course, ...days];
  for (const root of roots) {
    walk(root, (node) => {
      if (isMediaRef(node)) {
        const abs = join(dir, node.src);
        if (!existsSync(abs) || !statSync(abs).isFile()) {
          fail(`media file not found: ${node.src}`);
        }
        if (!isLicense(node.license)) {
          fail(`media object "${node.src}" is missing a valid license`);
        }
      }
      if (isPublic && isLicense(node) && node.type === 'local-only') {
        fail(`public pack contains a "local-only" license — refusing to publish`);
      }
    });
  }
}

function main(): void {
  const dirs = findPackDirs();
  if (dirs.length === 0) {
    console.error('No packs found.');
    process.exit(1);
  }

  const knownTags = new Set(SKILL_TAGS);
  if (knownTags.size !== SKILL_TAGS.length) {
    console.error('SKILL_TAGS contains duplicates.');
    process.exit(1);
  }

  const problems: Problem[] = [];
  for (const dir of dirs) validatePack(dir, problems);

  if (problems.length > 0) {
    console.error(`✕ validate:packs — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  [${p.pack}] ${p.message}`);
    process.exit(1);
  }
  console.log(`✓ validate:packs — ${dirs.length} pack(s) OK`);
}

main();
