import { useState } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';

const NOTICE_FLAG = 'migration.notice';

type Notice = { books: boolean; aiKey: boolean };

function read(): Notice | null {
  try {
    const raw = localStorage.getItem(NOTICE_FLAG);
    return raw ? (JSON.parse(raw) as Notice) : null;
  } catch {
    return null;
  }
}

/** One-time banner after a .online → .ru migration: names what couldn't be carried over (imported book
 *  files, the AI key) so the user re-adds them. Clears its flag on dismiss. */
export function MigrationNotice() {
  const [notice, setNotice] = useState<Notice | null>(read);
  const ru = useUiLang((s) => s.lang) === 'ru';
  if (!notice) return null;

  const dismiss = () => {
    try {
      localStorage.removeItem(NOTICE_FLAG);
    } catch {
      // ignore storage failures
    }
    setNotice(null);
  };

  const items = [
    notice.books && (ru ? 'импортированные книги' : 'imported books'),
    notice.aiKey && (ru ? 'ключ AI-помощника' : 'the AI key'),
  ].filter(Boolean) as string[];
  const list = items.join(ru ? ' и ' : ' and ');

  return (
    <div
      role="status"
      className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-2.5"
    >
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-teal-dim bg-teal-dim/10 px-3.5 py-2 text-sm">
        <span className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
          {ru ? 'перенос' : 'migrated'}
        </span>
        <span>
          {ru
            ? `Прогресс перенесён с dayenglish.online. Добавьте заново: ${list}.`
            : `Progress moved from dayenglish.online. Please re-add: ${list}.`}
        </span>
        <button
          type="button"
          onClick={dismiss}
          className="ml-1 rounded-sm bg-teal px-2.5 py-1 font-mono text-2xs font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
        >
          {ru ? 'Понятно' : 'Got it'}
        </button>
      </div>
    </div>
  );
}
