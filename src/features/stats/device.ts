const KEY = 'oxford-install-id';
let cached: string | null = null;

/** This browser's stable id, the device half of an activity row key. The sync branch keeps its own
 *  install id in Dexie `syncState` — seed that from this key on merge so the two agree. */
export function installId(): string {
  if (cached) return cached;
  try {
    cached = localStorage.getItem(KEY);
    if (!cached) {
      cached = crypto.randomUUID();
      localStorage.setItem(KEY, cached);
    }
  } catch {
    cached = crypto.randomUUID();
  }
  return cached;
}
