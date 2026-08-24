import { applySnapshot, type Snapshot } from '@/features/migration/snapshot';
import { decodeSnapshot } from '@/features/migration/codec';

// First-party receiver for the .online → .ru migration. Runs on its own page (no app, no SW), so it
// writes the real .ru storage — an embedded iframe would hit a partitioned bucket .ru never reads.
const FROM_FLAG = 'migration.fromOnline';
const NOTICE_FLAG = 'migration.notice';

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

async function run(): Promise<void> {
  const fragment = location.hash.slice(1);
  // Strip the payload from the URL bar and history before doing anything else.
  history.replaceState(null, '', location.pathname);
  if (!fragment) {
    location.replace('/');
    return;
  }

  let snapshot: Snapshot;
  try {
    snapshot = await decodeSnapshot(fragment);
  } catch {
    // Truncated or corrupt — never import partial data.
    manualNotice();
    return;
  }

  const dest = safeDest(snapshot.dest);
  // Already migrated on a prior visit → just continue (repeat .online visits re-hop harmlessly).
  if (localStorage.getItem(FROM_FLAG)) {
    location.replace(dest);
    return;
  }

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
    // Unexpected import failure — proceed anyway; the source data is still recoverable via file import.
  }
  location.replace(dest);
}

void run();
