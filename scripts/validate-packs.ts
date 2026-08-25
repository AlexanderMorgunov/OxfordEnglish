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

const EXERCISE_TYPES = new Set([
  'gap-fill', 'choice', 'spot-error', 'match', 'order-words',
  'dictation', 'translate', 'transform', 'minimal-pairs',
]);

/** Lowercase + strip surrounding quotes/brackets and trailing sentence punctuation for set-membership
 *  comparison (so `"Does"`, `Does?`, `«does»` all fold to `does`). */
function foldToken(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/^[«»"'([]+/, '')
    .replace(/[»«"')\].,;:?!]+$/, '')
    .trim();
}

/** If an instruction enumerates an answer set ("Do или Does?", "at, in or on?", "X / Y / Z?"), return
 *  the folded token set; otherwise null. Splits on `/ ,` and the word connectors или/or. */
function parseInstructionSet(text: string): Set<string> | null {
  // Split on `,` `/` and whitespace-delimited или/or (a \b won't fire around Cyrillic in JS regex).
  const parts = text
    .split(/\s*[,/]\s*|\s+(?:или|or)\s+/iu)
    .map(foldToken)
    .filter((p) => p.length > 0 && p.length <= 20);
  return parts.length >= 2 ? new Set(parts) : null;
}

/** Deterministic per-exercise checks. `fail` breaks the build (real bugs); `warn` is report-only. */
function checkExercise(ex: Record<string, unknown>, fail: (m: string) => void, warn: (m: string) => void): void {
  const type = ex.type;
  const id = typeof ex.id === 'string' ? ex.id : '(no id)';

  // A1 correctIndex within range.
  const listField = type === 'spot-error' ? ex.variants : ex.options;
  if (Array.isArray(listField) && typeof ex.correctIndex === 'number') {
    if (ex.correctIndex < 0 || ex.correctIndex >= listField.length) {
      fail(`exercise ${id}: correctIndex ${ex.correctIndex} out of range (0..${listField.length - 1})`);
    }
  }

  // A3 duplicate options/variants.
  if (Array.isArray(listField)) {
    const seen = new Set<string>();
    for (const opt of listField) {
      const k = foldToken(String(opt));
      if (k && seen.has(k)) fail(`exercise ${id}: duplicate option "${String(opt)}"`);
      seen.add(k);
    }
  }

  // A2 correctOrder is a permutation of tokens.
  if (type === 'order-words' && Array.isArray(ex.tokens) && Array.isArray(ex.correctOrder)) {
    const n = ex.tokens.length;
    const co = ex.correctOrder as unknown[];
    const sorted = [...co].map(Number).sort((a, b) => a - b);
    const isPerm = co.length === n && sorted.every((v, i) => v === i);
    if (!isPerm) fail(`exercise ${id}: correctOrder is not a permutation of tokens[0..${n - 1}]`);
  }

  // A4 explicit-set mismatch (report-only): instruction names a set, options add out-of-set items.
  if (type === 'choice' && Array.isArray(ex.options) && ex.instruction && typeof ex.instruction === 'object') {
    const instr = ex.instruction as { en?: unknown; ru?: unknown };
    const texts = [instr.en, instr.ru].filter((t): t is string => typeof t === 'string');
    const parsed = texts.map(parseInstructionSet).filter((s): s is Set<string> => s !== null);
    if (parsed.length) {
      const set = new Set(parsed.flatMap((s) => [...s]));
      const folded = ex.options.map((o) => foldToken(String(o)));
      // Only trust it as an enumeration of the options if at least two options are inside the set.
      if (folded.filter((o) => set.has(o)).length >= 2) {
        const out = ex.options.filter((o) => !set.has(foldToken(String(o))));
        if (out.length) {
          warn(`exercise ${id}: instruction set {${[...set].join(', ')}} but options add out-of-set: ${out.map((o) => `"${String(o)}"`).join(', ')}`);
        }
      }
    }
  }
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

function validatePack(dir: string, problems: Problem[], warnings: Problem[]): void {
  const rel = dir.replace(ROOT + '\\', '').replace(ROOT + '/', '');
  const fail = (message: string) => problems.push({ pack: rel, message });
  const warn = (message: string) => warnings.push({ pack: rel, message });

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
    const exercises: Record<string, unknown>[] = [];
    walk(day, (node) => {
      if (typeof node !== 'object' || node === null) return;
      const obj = node as Record<string, unknown>;
      if (typeof obj.id === 'string' && obj.id !== day.id) addId(obj.id, `day ${day.id}`);
      if (typeof obj.type === 'string' && EXERCISE_TYPES.has(obj.type)) {
        exercises.push(obj);
        checkExercise(obj, fail, warn);
      }
    });
    // A5 within-section verbatim duplicate (report-only — may be intentional spaced practice).
    const firstByContent = new Map<string, string>();
    for (const ex of exercises) {
      const id = typeof ex.id === 'string' ? ex.id : '';
      const section = id.replace(/\.[^.]+$/, '');
      const { id: _omit, ...rest } = ex;
      const key = `${section}::${JSON.stringify(rest)}`;
      const prev = firstByContent.get(key);
      if (prev) warn(`exercise ${id}: verbatim duplicate of ${prev} (same section) — intentional spaced practice?`);
      else firstByContent.set(key, id);
    }
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
  const warnings: Problem[] = [];
  for (const dir of dirs) validatePack(dir, problems, warnings);

  // Report-only findings (explicit-set mismatch, within-section dupes): logged, never fail the build —
  // the pattern is pervasive and a gate would break CI until the whole content backlog is triaged.
  if (warnings.length > 0) {
    console.warn(`⚠ validate:packs — ${warnings.length} logical warning(s) (report-only):\n`);
    for (const w of warnings) console.warn(`  [${w.pack}] ${w.message}`);
    console.warn('');
  }

  if (problems.length > 0) {
    console.error(`✕ validate:packs — ${problems.length} problem(s):\n`);
    for (const p of problems) console.error(`  [${p.pack}] ${p.message}`);
    process.exit(1);
  }
  console.log(`✓ validate:packs — ${dirs.length} pack(s) OK${warnings.length ? ` (${warnings.length} warning(s) above)` : ''}`);
}

main();
