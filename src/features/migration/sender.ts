import { buildSnapshot, hasProgress, type Snapshot } from './snapshot';
import { encodeSnapshot } from './codec';
import { RECEIVER_PATH } from './receiver';

const CANONICAL = 'https://dayenglish.ru';
// Conservative on purpose: a light/moderate profile (the real `.online` population) is a few KB, so it
// sails through; anything bigger takes the reliable file fallback ON `.online` (where the data is)
// rather than risk a Safari-clipped URL that would strand the user on an empty `.ru`. No optimistic
// "already sent" flag — the receiver's `.ru`-side flag makes re-import idempotent, so a failed hand-off
// simply retries on the next `.online` visit (self-healing) instead of getting permanently stuck.
const FRAGMENT_BUDGET = 60_000;

/** True on the `.online` mirror, whose per-origin data we migrate to the canonical `.ru`. */
export function isMirrorHost(): boolean {
  const h = location.hostname;
  return h === 'dayenglish.online' || h === 'www.dayenglish.online';
}

function redirect(dest: string): void {
  location.replace(CANONICAL + dest);
}

async function unregisterSelf(): Promise<void> {
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // best-effort: a lingering SW just means the mirror keeps working offline a bit longer
  }
}

function overlay(inner: string): void {
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;` +
    `background:#12141c;color:#e7e9ee;font-family:system-ui,sans-serif;padding:24px;text-align:center;line-height:1.5">` +
    `<div style="max-width:32rem">${inner}</div></div>`;
}

function manualFallback(dest: string): void {
  // Static markup only — the visitor-controlled `dest` is set below as an href *property*, never
  // interpolated into innerHTML.
  overlay(
    `<p style="font-size:1.1rem;margin-bottom:1rem">У вас много данных — перенесём вручную.</p>` +
      `<p style="color:#a8adba;margin-bottom:1.5rem">Скачайте файл прогресса, затем откройте ` +
      `dayenglish.ru → Настройки → Импорт и загрузите его.</p>` +
      `<div id="mig-actions"></div>`
  );
  const actions = document.getElementById('mig-actions');
  if (!actions) return;

  const download = document.createElement('button');
  download.textContent = 'Скачать файл прогресса';
  download.style.cssText =
    'background:#5b8cff;color:#0b0d13;border:0;border-radius:8px;padding:10px 18px;font-size:1rem;cursor:pointer';
  download.addEventListener('click', () => {
    void (async () => {
      // A file isn't size-bound, so carry the FULL snapshot (with history) — the same envelope the
      // .ru import understands, not the lossy legacy backup.
      const full = await buildSnapshot();
      const url = URL.createObjectURL(new Blob([JSON.stringify(full)], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dayenglish-progress.json';
      a.click();
      URL.revokeObjectURL(url);
    })();
  });

  const go = document.createElement('a');
  go.textContent = 'Перейти на dayenglish.ru →';
  go.href = CANONICAL + dest;
  go.style.cssText = 'color:#5b8cff;display:block;margin-top:12px';

  actions.append(download, go);
}

async function anyLocalToMigrate(snapshot: Snapshot): Promise<boolean> {
  return (
    (await hasProgress()) ||
    Object.keys(snapshot.local).length > 0 ||
    (snapshot.dexie.bookmarks?.length ?? 0) > 0
  );
}

/**
 * Cross-**site** migration `.online` → `.ru`. Reads this origin's snapshot and carries it in the URL
 * fragment to a first-party `.ru` receiver (an iframe would write a partitioned bucket `.ru` never
 * reads). Always ends by leaving `.online`; on any failure it just redirects, leaving the local data
 * intact and recoverable via file export.
 */
export async function migrateThenRedirect(): Promise<void> {
  const dest = location.pathname + location.search + location.hash;
  try {
    overlay(`<p style="font-size:1.1rem">Переносим ваш прогресс на dayenglish.ru…</p>`);
    let snapshot = await buildSnapshot();
    // Nothing worth carrying → skip the migrate hop entirely.
    if (!(await anyLocalToMigrate(snapshot))) return redirect(dest);

    snapshot.dest = dest;
    let encoded = await encodeSnapshot(snapshot);
    if (encoded.length > FRAGMENT_BUDGET) {
      snapshot = await buildSnapshot({ includeHistory: false });
      snapshot.dest = dest;
      encoded = await encodeSnapshot(snapshot);
    }
    if (encoded.length > FRAGMENT_BUDGET) return manualFallback(dest);

    await unregisterSelf();
    location.replace(`${CANONICAL}${RECEIVER_PATH}#${encoded}`);
  } catch {
    redirect(dest);
  }
}
