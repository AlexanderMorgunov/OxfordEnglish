import { applySnapshot, type Snapshot } from './snapshot';
import { decodeSnapshot } from './codec';

// First-party receiver for the .online → .ru migration. Served as the SPA index.html at `/migrate`
// (via the SW navigate-fallback or the bucket error doc) and handled here in main.tsx BEFORE the app
// boots — so it writes the real .ru storage and skips SW registration / analytics for a mere hop.
export const RECEIVER_PATH = '/migrate';
const FROM_FLAG = 'migration.fromOnline';
const NOTICE_FLAG = 'migration.notice';

export function isReceiverPath(): boolean {
  return location.pathname === RECEIVER_PATH;
}

function safeDest(dest: string | undefined): string {
  return dest && dest.startsWith('/') && !dest.startsWith('//') ? dest : '/';
}

function overlay(inner: string): void {
  document.body.innerHTML =
    `<div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;` +
    `background:#12141c;color:#e7e9ee;font-family:system-ui,sans-serif;padding:24px;text-align:center;line-height:1.5">` +
    `<div style="max-width:32rem">${inner}</div></div>`;
}

function manualNotice(): void {
  overlay(
    `<p style="font-size:1.1rem;margin-bottom:1rem">Не удалось перенести автоматически.</p>` +
      `<p style="color:#a8adba;margin-bottom:1.5rem">Ваш прогресс сохранён на старом адресе. ` +
      `Экспортируйте его там файлом и загрузите здесь через Настройки → Импорт.</p>` +
      `<a href="/" style="color:#5b8cff">Продолжить на dayenglish.ru →</a>`
  );
}

export async function receiveMigration(): Promise<void> {
  overlay(`<p style="font-size:1.1rem">Переносим ваш прогресс…</p>`);
  const fragment = location.hash.slice(1);
  // Strip the payload from the URL bar and history before anything else.
  history.replaceState(null, '', location.pathname);
  if (!fragment) return void location.replace('/');

  let snapshot: Snapshot;
  try {
    snapshot = await decodeSnapshot(fragment);
  } catch {
    // Truncated or corrupt — never import partial data.
    return manualNotice();
  }

  const dest = safeDest(snapshot.dest);
  if (localStorage.getItem(FROM_FLAG)) return void location.replace(dest);

  try {
    const result = await applySnapshot(snapshot);
    localStorage.setItem(FROM_FLAG, String(Date.now()));
    if (result === 'imported') {
      const notice = {
        books: snapshot.booksCount > 0,
        aiKey: Boolean(snapshot.local['oxford-ai-config']),
      };
      if (notice.books || notice.aiKey) localStorage.setItem(NOTICE_FLAG, JSON.stringify(notice));
    }
  } catch {
    // Unexpected import failure — proceed anyway; the source data stays recoverable via file import.
  }
  location.replace(dest);
}
