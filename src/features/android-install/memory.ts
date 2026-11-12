import {
  getDataOwnerRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { tourOwner } from '@/features/onboarding/memory';

export const RUSTORE_URL =
  'https://www.rustore.ru/catalog/app/ru.dayenglish.app';
const CHOICE = 'dayenglish.android-install.v1.choice';
const PENDING = 'dayenglish.android-install.v1.pending';
const listeners = new Set<() => void>();
let suppressed = false;
let pendingOwner: string | null | undefined;
let pendingRevision = getDataOwnerRevision();
const notify = () => listeners.forEach((listener) => listener());

function declined(): boolean {
  if (suppressed) return true;
  try {
    return localStorage.getItem(CHOICE) !== null;
  } catch {
    return false;
  }
}

export function androidInstallPending(): boolean {
  if (pendingRevision !== getDataOwnerRevision()) return false;
  if (pendingOwner === undefined) {
    try {
      pendingOwner = sessionStorage.getItem(PENDING);
    } catch {
      pendingOwner = null;
    }
  }
  return !declined() && pendingOwner === tourOwner();
}

export function queueAndroidInstall(): void {
  if (declined()) return;
  pendingOwner = tourOwner();
  pendingRevision = getDataOwnerRevision();
  try {
    sessionStorage.setItem(PENDING, pendingOwner);
  } catch {
    /* The current tab still retains the completed study event. */
  }
  notify();
}

function clearPending(): void {
  pendingOwner = null;
  try {
    sessionStorage.removeItem(PENDING);
  } catch {
    /* Memory is authoritative for this tab. */
  }
  notify();
}

const unsubscribeScope = subscribeDataScope((change) => {
  if (change === 'reset') clearPending();
  else {
    const pending = androidInstallPending();
    const owner = pendingOwner;
    queueMicrotask(() => {
      // Account persistence follows the adoption notification in applySession.
      if (
        pending &&
        pendingOwner === owner &&
        pendingRevision === getDataOwnerRevision()
      )
        queueAndroidInstall();
      else notify();
    });
  }
});
import.meta.hot?.dispose(unsubscribeScope);

export function hideAndroidInstall(reason: 'dismissed' | 'store'): boolean {
  suppressed = true;
  let saved = true;
  try {
    localStorage.setItem(CHOICE, reason);
  } catch {
    saved = false;
  }
  clearPending();
  return saved;
}

export function subscribeAndroidInstall(listener: () => void): () => void {
  listeners.add(listener);
  const storage = (event: StorageEvent) => {
    if (event.key === CHOICE || event.key === 'oxford-account' || event.key === null) listener();
  };
  window.addEventListener('storage', storage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', storage);
  };
}
