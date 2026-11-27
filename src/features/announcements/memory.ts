const prefix = 'dayenglish.announcements.v1:';
const inMemory = new Set<string>();
const listeners = new Set<() => void>();

function key(owner: string, id: string) {
  return `${prefix}${owner}:${encodeURIComponent(id)}`;
}

export function announcementSeen(owner: string, id: string): boolean {
  const storageKey = key(owner, id);
  if (inMemory.has(storageKey)) return true;
  try {
    return localStorage.getItem(storageKey) === 'seen';
  } catch {
    return false;
  }
}

export function rememberAnnouncement(owner: string, id: string) {
  if (announcementSeen(owner, id)) return;
  const storageKey = key(owner, id);
  try {
    localStorage.setItem(storageKey, 'seen');
  } catch {
    inMemory.add(storageKey);
  }
  for (const listener of listeners) listener();
}

export function subscribeAnnouncementMemory(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) listener();
  };
  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}
