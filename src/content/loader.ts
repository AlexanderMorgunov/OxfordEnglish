import {
  CourseIndex,
  Day,
  GrammarReference,
  PackManifest,
  type GrammarArticle,
  type UnitIndex,
} from './schema';

export const PUBLIC_PACK_BASE = '/packs/dev-english-a2';

/** The one pack file robots.txt lets a crawler fetch, because /grammar and /grammar/<id> are indexable
 *  and render from it. Named here so the loader and robots.txt cannot drift apart silently. */
export const GRAMMAR_URL = `${PUBLIC_PACK_BASE}/grammar.json`;

/** Resolve a pack-relative MediaRef.src to a fetchable URL. */
export function packMediaUrl(src: string): string {
  return `${PUBLIC_PACK_BASE}/${src.replace(/^\//, '')}`;
}

export type LoadedUnit = UnitIndex & { days: Day[] };

export type LoadedPack = {
  manifest: PackManifest;
  course: CourseIndex;
  units: LoadedUnit[];
  days: Map<string, Day>;
  grammar: GrammarArticle[];
};

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(path);
  if (!res.ok) throw new Error(`Failed to fetch ${path}: ${res.status}`);
  return res.json();
}

export async function loadPublicPack(): Promise<LoadedPack> {
  const [manifestRaw, courseRaw] = await Promise.all([
    fetchJson(`${PUBLIC_PACK_BASE}/manifest.json`),
    fetchJson(`${PUBLIC_PACK_BASE}/course.json`),
  ]);
  const manifest = PackManifest.parse(manifestRaw);
  const course = CourseIndex.parse(courseRaw);

  const dayIds = course.units.flatMap((u) => u.dayIds);
  const parsed = await Promise.all(
    dayIds.map(async (id) =>
      Day.parse(await fetchJson(`${PUBLIC_PACK_BASE}/days/${id}.json`))
    )
  );
  const days = new Map(parsed.map((d) => [d.id, d]));

  const units: LoadedUnit[] = course.units.map((u) => ({
    ...u,
    days: u.dayIds.flatMap((id) => {
      const day = days.get(id);
      return day ? [day] : [];
    }),
  }));

  // Grammar reference is optional — the pack works without it.
  let grammar: GrammarArticle[] = [];
  try {
    grammar = await loadGrammarOnly();
  } catch {
    grammar = [];
  }

  return { manifest, course, units, days, grammar };
}

/**
 * The grammar reference on its own — one fetch, no manifest, no course, no 213 day files.
 *
 * `loadPublicPack` reads every day before it reaches grammar, so one missing day used to take the whole
 * reference down with it. That mattered far beyond offline: /grammar and its 48 topic pages are the
 * site's indexable content, and a failed load renders them as "article not found" to whoever is looking
 * — Googlebot included. Reading through the same URL as the pack keeps the two from drifting.
 */
export async function loadGrammarOnly(): Promise<GrammarArticle[]> {
  return GrammarReference.parse(await fetchJson(GRAMMAR_URL));
}
