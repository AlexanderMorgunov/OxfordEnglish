import type { LoadedPack } from '@/content/loader';
import type { Exercise } from '@/content/schema';
import { shuffle } from '@/features/practice/shuffle';

function exercisesOf(pack: LoadedPack, unitPredicate: (id: string) => boolean): Exercise[] {
  return pack.units
    .filter((u) => unitPredicate(u.id))
    .flatMap((u) => u.days)
    .flatMap((d) => d.sections)
    .flatMap((s) => (s.type === 'practice' || s.type === 'listening' ? s.exercises : []));
}

/**
 * Assemble a checkpoint: mostly the unit's own exercises plus a few interleaved
 * from earlier units (interleaving beats blocked review — DESIGN_DOC §5.6).
 */
export function buildCheckpoint(
  pack: LoadedPack,
  unitId: string,
  count = 12
): Exercise[] {
  const own = shuffle(exercisesOf(pack, (id) => id === unitId));
  const others = shuffle(exercisesOf(pack, (id) => id !== unitId));
  const interleave = Math.min(others.length, Math.floor(count / 4));
  const picked = own.slice(0, Math.max(0, count - interleave));
  return shuffle([...picked, ...others.slice(0, interleave)]);
}

/** For each weak tag, which days teach it — the personal review plan (§5.6). */
export function reviewPlan(
  pack: LoadedPack,
  weakTags: string[]
): { tag: string; dayIds: string[] }[] {
  return weakTags.map((tag) => {
    const dayIds = pack.units
      .flatMap((u) => u.days)
      .filter((d) =>
        d.sections.some(
          (s) =>
            (s.type === 'practice' || s.type === 'listening') &&
            s.exercises.some((e) => (e.tags as readonly string[]).includes(tag))
        )
      )
      .map((d) => d.id);
    return { tag, dayIds };
  });
}
