const PREFIX = 'dayenglish-contextual-tour:v1:';
export type TourMemory = 'shown' | 'dismissed' | 'completed';

export function tourOwner(): string {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem('oxford-account') ?? '{}'
    );
    if (value && typeof value === 'object') {
      for (const key of ['accountId', 'dataOwner', 'lastAccountId'] as const) {
        const id = Reflect.get(value, key);
        if (typeof id === 'string' && id && id.length <= 256) return id;
      }
    }
  } catch {
    /* An unavailable account store is an anonymous local owner. */
  }
  return 'local';
}
const key = (owner: string, page: string) => `${PREFIX}${owner}:${page}`;
export function readTour(
  owner: string,
  page: string
): TourMemory | 'unavailable' | null {
  try {
    const value = localStorage.getItem(key(owner, page));
    return value === null ||
      value === 'shown' ||
      value === 'dismissed' ||
      value === 'completed'
      ? value
      : 'unavailable';
  } catch {
    return 'unavailable';
  }
}
export function rememberTour(
  owner: string,
  page: string,
  status: TourMemory
): boolean {
  try {
    if (readTour(owner, page) !== 'completed')
      localStorage.setItem(key(owner, page), status);
    return true;
  } catch {
    return false;
  }
}
export function adoptTourMemory(from: string, to: string): void {
  if (from === to) return;
  try {
    const prefix = `${PREFIX}${from}:`;
    const keys = Array.from({ length: localStorage.length }, (_, i) =>
      localStorage.key(i)
    );
    for (const old of keys) {
      if (!old?.startsWith(prefix)) continue;
      const page = old.slice(prefix.length),
        value = readTour(from, page);
      if (readTour(to, page) === null && value && value !== 'unavailable')
        rememberTour(to, page, value);
    }
  } catch {
    /* Manual help remains available without persistence. */
  }
}
