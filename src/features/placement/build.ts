import type { LoadedPack } from '@/content/loader';
import type { Exercise, Level } from '@/content/schema';

export type Band = 'easy' | 'mid' | 'hard';

export type PlacementQuestion = { band: Band; exercise: Exercise };

/** Units each band draws from, and how many questions to take from each unit. */
const BAND_SOURCES: Record<Band, { unitId: string; take: number }[]> = {
  easy: [
    { unitId: 'u01', take: 2 }, // be, have got
    { unitId: 'u02', take: 2 }, // present simple
  ],
  mid: [
    { unitId: 'u04', take: 2 }, // past simple
    { unitId: 'u09', take: 2 }, // comparatives / quantifiers
  ],
  hard: [
    { unitId: 'u12', take: 2 }, // present perfect
    { unitId: 'u13', take: 1 }, // conditionals
    { unitId: 'u14', take: 1 }, // passive
  ],
};

/** Deterministic: choice/gap-fill items from a unit, in day → section → order. */
function pickFromUnit(pack: LoadedPack, unitId: string, take: number): Exercise[] {
  const unit = pack.units.find((u) => u.id === unitId);
  if (!unit) return [];
  const items: Exercise[] = [];
  for (const day of unit.days) {
    for (const section of day.sections) {
      if (section.type !== 'practice' && section.type !== 'listening') continue;
      for (const ex of section.exercises) {
        if (ex.type === 'choice' || ex.type === 'gap-fill') items.push(ex);
      }
    }
  }
  return items.slice(0, take);
}

/** A fixed diagnostic: 4 easy + 4 mid + 4 hard, always the same for a given pack. */
export function buildPlacement(pack: LoadedPack): PlacementQuestion[] {
  const out: PlacementQuestion[] = [];
  for (const band of ['easy', 'mid', 'hard'] as Band[]) {
    for (const { unitId, take } of BAND_SOURCES[band]) {
      for (const exercise of pickFromUnit(pack, unitId, take)) out.push({ band, exercise });
    }
  }
  return out;
}

export type BandScore = { correct: number; total: number };

export type PlacementOutcome = {
  level: Level;
  recommendedUnitId: string;
  message: string;
  b1Ready: boolean;
};

/**
 * Map per-band scores to a starting point. Bands gate in order: a learner who
 * misses the basics starts at the A1 refresh; one who aces everything is sent to
 * review the last units (there is no B1 content yet — never route past it).
 */
export function scorePlacement(scores: Record<Band, BandScore>): PlacementOutcome {
  const { easy, mid, hard } = scores;
  if (easy.correct < 3) {
    return {
      level: 'A1',
      recommendedUnitId: 'u00',
      message: 'Start from the basics — the A1 refresh will set you up.',
      b1Ready: false,
    };
  }
  if (mid.correct < 2) {
    return {
      level: 'A2',
      recommendedUnitId: 'u01',
      message: 'You have the basics — start the course from the beginning.',
      b1Ready: false,
    };
  }
  if (hard.correct < 3) {
    return {
      level: 'A2',
      recommendedUnitId: 'u10',
      message: 'Solid A2 — jump ahead to futures and the present perfect.',
      b1Ready: false,
    };
  }
  return {
    level: 'B1',
    recommendedUnitId: 'u13',
    message: "Excellent — you're ready for B1. Review the last units; B1 content is coming.",
    b1Ready: true,
  };
}
