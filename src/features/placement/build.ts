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

/**
 * Deterministic pick of self-contained questions from a unit. Only practice
 * sections — listening exercises test recall of the day's audio, not language,
 * so they are unanswerable out of context. Choice comes before gap-fill:
 * unambiguous and typo-proof, with cue-bearing gap-fills as a fallback.
 */
function pickFromUnit(pack: LoadedPack, unitId: string, take: number): Exercise[] {
  const unit = pack.units.find((u) => u.id === unitId);
  if (!unit) return [];
  const choice: Exercise[] = [];
  const gapFill: Exercise[] = [];
  for (const day of unit.days) {
    for (const section of day.sections) {
      if (section.type !== 'practice') continue;
      for (const ex of section.exercises) {
        if (ex.type === 'choice') choice.push(ex);
        else if (ex.type === 'gap-fill') gapFill.push(ex);
      }
    }
  }
  return [...choice, ...gapFill].slice(0, take);
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
    recommendedUnitId: 'u15',
    message: "Excellent — you're ready for B1. Start the B1 units.",
    b1Ready: true,
  };
}
