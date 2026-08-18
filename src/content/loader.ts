import {
  CourseIndex,
  Day,
  GrammarReference,
  PackManifest,
  type GrammarArticle,
  type UnitIndex,
} from './schema';

export const PUBLIC_PACK_BASE = '/packs/dev-english-a2';

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
    grammar = GrammarReference.parse(await fetchJson(`${PUBLIC_PACK_BASE}/grammar.json`));
  } catch {
    grammar = [];
  }

  return { manifest, course, units, days, grammar };
}
