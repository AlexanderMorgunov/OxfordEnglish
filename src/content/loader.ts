import { abortReason, withDeadline } from '@/shared/lib/deadline';
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

const DAY_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [400, 800];

class PackHttpError extends Error {
  constructor(path: string, readonly status: number) {
    super(`Failed to fetch ${path}: ${status}`);
  }
}

function isTransient(error: unknown): boolean {
  if (error instanceof PackHttpError) return [408, 500, 502, 503, 504].includes(error.status);
  return error instanceof TypeError
    || ((error instanceof Error || error instanceof DOMException) && error.name === 'TimeoutError');
}

function waitToRetry(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortReason(signal));
      return;
    }
    const cleanup = () => signal?.removeEventListener('abort', abort);
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timer);
      cleanup();
      if (signal) reject(abortReason(signal));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function fetchJson(path: string, signal?: AbortSignal): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await withDeadline(REQUEST_TIMEOUT_MS, signal, async (requestSignal) => {
        const res = await fetch(path, { signal: requestSignal });
        if (!res.ok) throw new PackHttpError(path, res.status);
        return res.json();
      });
    } catch (error) {
      const delay = RETRY_DELAYS_MS[attempt];
      if (signal?.aborted || delay === undefined || !isTransient(error)) throw error;
      await waitToRetry(delay, signal);
    }
  }
}

async function loadDays(dayIds: string[], controller: AbortController): Promise<Day[]> {
  const parsed = new Array<Day>(dayIds.length);
  let next = 0;
  const worker = async () => {
    while (!controller.signal.aborted && next < dayIds.length) {
      const index = next++;
      try {
        parsed[index] = Day.parse(await fetchJson(
          `${PUBLIC_PACK_BASE}/days/${dayIds[index]}.json`, controller.signal
        ));
      } catch (error) {
        // Drain aborted workers before a manual retry can start another batch.
        controller.abort(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(DAY_CONCURRENCY, dayIds.length) }, worker));
  if (controller.signal.aborted) throw abortReason(controller.signal);
  return parsed;
}

async function loadPack(controller: AbortController): Promise<LoadedPack> {
  const [manifestRaw, courseRaw] = await Promise.all([
    fetchJson(`${PUBLIC_PACK_BASE}/manifest.json`, controller.signal),
    fetchJson(`${PUBLIC_PACK_BASE}/course.json`, controller.signal),
  ]);
  const manifest = PackManifest.parse(manifestRaw);
  const course = CourseIndex.parse(courseRaw);

  const dayIds = course.units.flatMap((u) => u.dayIds);
  const parsed = await loadDays(dayIds, controller);
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

export async function loadPublicPack(): Promise<LoadedPack> {
  const controller = new AbortController();
  try {
    return await loadPack(controller);
  } finally {
    controller.abort();
  }
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
