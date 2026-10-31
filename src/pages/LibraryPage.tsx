import { useEffect, useMemo, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import type { BookRecord } from '@/db/db';
import { Button, Card, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { importBook, listBooks, removeBook } from '@/features/reader/service';
import {
  opfsAvailable,
  requestPersistence,
  storagePersisted,
} from '@/features/reader/storage';
import { isNativePlatform } from '@/shared/lib/platform';
import {
  useBookFileSync,
  useBookUploadIssues,
  type UploadIssue,
} from '@/features/reader/blobSync';
import { useAccount } from '@/features/account/store';
import { LibraryDialog } from '@/features/reader/LibraryDialog';
import type { LibraryModal } from '@/features/reader/LibraryDialog';
import { db } from '@/db/db';
import { loadCatalog, cachedCatalogIds } from '@/features/reader/catalog';
import type { CatalogEntry } from '@/features/reader/catalog';
import { BOOK_OPEN_PREFIX, openedAt } from '@/features/reader/book-recency';
import { readerReturnPath } from '@/features/reader/return-to-reader';
import { getBookFile } from '@/features/reader/storage';
import { useLibraryView } from '@/features/reader/library-state';
import {
  BookCover,
  BookProgress,
  BookAvailability,
  LibraryBook,
} from '@/features/reader/LibraryBook';
import type { ShelfBook } from '@/features/reader/LibraryBook';
import '@/features/reader/library.css';
import { BackToReader } from '@/features/reader/BackToReader';
import { readProgress } from '@/features/stats/useReadingTracker';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';

/**
 * One reason usually covers several books at once — the account has no Pro, the cloud is full, the
 * connection is down — and repeating the same two-line explanation under each of them turns the library
 * into wallpaper. So a reason shared by MORE THAN ONE book is explained once above the list, and those
 * books only carry a short "which ones" marker. A reason that affects a single book stays on that book,
 * where it reads as the fact about that file it is.
 */
const ISSUE_ORDER = [
  'no-plan',
  'quota',
  'signed-out',
  'error',
  'too-large',
] as const;
const PERMANENT: readonly UploadIssue[] = ['too-large', 'no-plan'];

const perBookText = (ru: boolean): Record<UploadIssue, string> =>
  ru
    ? {
        'too-large':
          'Не уйдёт в облако: файл больше 20 МБ. На этом устройстве книга есть.',
        quota:
          'Не уместилось в облако — место кончилось. Освободите его, и книга уйдёт сама.',
        'no-plan':
          'Копия в облаке входит в Pro. Книга есть на этом устройстве.',
        error: 'Пока не ушло в облако. Попробуем ещё раз автоматически.',
        'signed-out': 'Пока не ушло в облако: не получается обновить вход.',
      }
    : {
        'too-large':
          'Will not go to the cloud: over 20 MB. The book is here on this device.',
        quota:
          'Did not fit in the cloud — it is full. Free some space and this goes up on its own.',
        'no-plan':
          'A cloud copy is part of Pro. The book is here on this device.',
        error: 'Not in the cloud yet. We will try again automatically.',
        'signed-out': 'Not in the cloud yet: cannot refresh your sign-in.',
      };

const groupText = (ru: boolean): Record<UploadIssue, string> =>
  ru
    ? {
        'too-large':
          'Отмеченные файлы больше 20 МБ — в облако они не уйдут. На этом устройстве книги есть.',
        quota:
          'В облаке кончилось место, поэтому отмеченные книги не загрузились. Освободите место — они уйдут сами.',
        'no-plan':
          'Копии книг в облаке входят в Pro. Отмеченные книги есть только на этом устройстве.',
        error:
          'Отмеченные книги пока не ушли в облако. Попробуем ещё раз автоматически.',
        'signed-out':
          'Не получается обновить вход, поэтому отмеченные книги пока не в облаке.',
      }
    : {
        'too-large':
          'The marked files are over 20 MB, so they will not go to the cloud. The books are here on this device.',
        quota:
          'The cloud is full, so the marked books did not upload. Free some space and they go up on their own.',
        'no-plan':
          'Cloud copies of books are part of Pro. The marked books are only on this device.',
        error:
          'The marked books are not in the cloud yet. We will try again automatically.',
        'signed-out':
          'Cannot refresh your sign-in, so the marked books are not in the cloud yet.',
      };

function GroupedUploadNotice({
  ru,
  issue,
}: {
  ru: boolean;
  issue: UploadIssue;
}) {
  return (
    <Card className="mb-4 border-amber-dim">
      <p className="text-sm text-muted">{groupText(ru)[issue]}</p>
    </Card>
  );
}

/**
 * Why this device's copy of a book is not in the cloud. Deliberately not a button: `sweepBookFiles`
 * already retries every ten minutes, so the honest thing to render is the reason, not a control that
 * duplicates what is already happening. Silent when the book is fine, which is the common case.
 */
function UploadIssueLine({
  ru,
  issue,
  grouped,
}: {
  ru: boolean;
  issue: UploadIssue | undefined;
  grouped: boolean;
}) {
  if (!issue) return null;
  const tone = PERMANENT.includes(issue) ? 'text-muted' : 'text-amber';
  // The cause is already stated once above; here the book only has to identify itself as one of them.
  if (grouped)
    return (
      <p className={`mt-1 font-mono text-2xs ${tone}`}>
        {ru ? 'не в облаке' : 'not in the cloud'}
      </p>
    );
  return (
    <p className={`mt-1 font-mono text-2xs ${tone}`}>
      {perBookText(ru)[issue]}
    </p>
  );
}

function markedFinished(id: string): boolean {
  try {
    return localStorage.getItem('reader.' + id + '.finished') === '1';
  } catch {
    return false;
  }
}

export function LibraryPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const location = useLocation();
  const navigate = useNavigate();
  const tab = location.pathname === '/library/catalog' ? 'catalog' : 'own';
  const view = useLibraryView();
  const filters = view[tab];
  const inputRef = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLElement>(null);
  const abort = useRef<AbortController | null>(null);
  const restored = useRef(false);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>(
    'loading'
  );
  const [catalogStatus, setCatalogStatus] = useState<
    'loading' | 'ready' | 'error'
  >('loading');
  const [revision, setRevision] = useState(0);
  const [catalogRetry, setCatalogRetry] = useState(0);
  const [availability, setAvailability] = useState<Record<string, boolean>>({});
  const [cached, setCached] = useState(new Set<string>());
  const [opens, setOpens] = useState(new Map<string, number>());
  const [persisted, setPersisted] = useState(true);
  const [message, setMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');
  const [modal, setModal] = useState<LibraryModal | null>(null);
  const supported = opfsAvailable();
  const native = isNativePlatform();
  const issues = useBookUploadIssues((s) => s.issues);
  const syncOn = useBookFileSync((s) => s.enabled);
  const signedIn = useAccount((s) => s.status === 'authenticated');
  const issueFor = (id: string) =>
    syncOn && signedIn ? issues[id] : undefined;
  const groupedIssues = ISSUE_ORDER.filter(
    (issue) => books.filter((book) => issueFor(book.id) === issue).length > 1
  );

  useEffect(
    () =>
      subscribeDataScope(() => {
        abort.current?.abort();
        setModal(null);
        setBooks([]);
        setAvailability({});
        setOpens(new Map());
        setMessage('');
        setDeleteError('');
        setDeleting(false);
        setStatus('loading');
        setRevision((v) => v + 1);
      }),
    []
  );
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    const owner = captureDataScope();
    const subscription = liveQuery(listBooks).subscribe({
      next: (rows) => {
        if (owner()) {
          setBooks(rows);
          setStatus('ready');
        }
      },
      error: () => {
        if (owner()) setStatus('error');
      },
    });
    const recent = liveQuery(() =>
      db.settings.where('key').startsWith(BOOK_OPEN_PREFIX).toArray()
    ).subscribe({
      next: (rows) => {
        if (owner())
          setOpens(
            new Map(
              rows
                .filter((r) => !r.deletedAt || r.deletedAt < (r.updatedAt ?? 0))
                .map((r) => [
                  r.key.slice(BOOK_OPEN_PREFIX.length),
                  openedAt(r.value),
                ])
            )
          );
      },
      error: () => {},
    });
    return () => {
      subscription.unsubscribe();
      recent.unsubscribe();
    };
  }, [revision]);
  useEffect(() => {
    let alive = true;
    void loadCatalog({ strict: true }).then(
      (rows) => {
        if (alive) {
          setCatalog(rows);
          setCatalogStatus('ready');
        }
      },
      () => {
        if (alive) setCatalogStatus('error');
      }
    );
    void cachedCatalogIds().then((ids) => {
      if (alive) setCached(ids);
    });
    return () => {
      alive = false;
    };
  }, [catalogRetry]);
  useEffect(() => {
    let alive = true;
    if (supported)
      void storagePersisted().then((value) => {
        if (alive) setPersisted(value);
      });
    return () => {
      alive = false;
    };
  }, [supported]);
  useEffect(() => {
    let alive = true;
    const owner = captureDataScope();
    const check = async () => {
      const pairs = await Promise.all(
        books.map(async (book) => {
          try {
            await getBookFile(book.id);
            return [book.id, true] as const;
          } catch {
            try {
              return [
                book.id,
                !!(await db.catalogCache.get(`pdf:${book.id}`)),
              ] as const;
            } catch {
              return [book.id, false] as const;
            }
          }
        })
      );
      if (alive && owner()) setAvailability(Object.fromEntries(pairs));
    };
    void check();
    window.addEventListener('focus', check);
    return () => {
      alive = false;
      window.removeEventListener('focus', check);
    };
  }, [books]);
  const lastPath = readerReturnPath();
  const own: ShelfBook[] = books.map((book) => ({
    ...book,
    href: `/library/${book.id}`,
    opened:
      (opens.get(book.id) ?? 0) > 0 ||
      book.lastChapter > 0 ||
      lastPath === `/library/${book.id}`,
    progress: markedFinished(book.id) ? 1 : readProgress(`reader.${book.id}`),
    markedFinished: markedFinished(book.id),
    local: availability[book.id],
  }));
  const curated: ShelfBook[] = catalog.map((book) => ({
    ...book,
    id: `catalog:${book.id}`,
    href: `/library/catalog/${book.id}`,
    opened: lastPath === `/library/catalog/${book.id}`,
    progress: readProgress(`reader.catalog.${book.id}`),
    local: (native && book.kind === 'bundled') || cached.has(book.id),
  }));
  const all = tab === 'own' ? own : curated;
  const currentStatus = tab === 'own' ? status : catalogStatus;
  const checkingLocal =
    tab === 'own' &&
    filters.local &&
    own.some((book) => book.local === undefined);
  const resume =
    [...own, ...curated].find(
      (book) => book.href === lastPath && book.progress !== 1
    ) ?? own.find((book) => book.opened && book.progress !== 1);
  const filtered = all
    .filter((book) => {
      const q = filters.query.trim().toLocaleLowerCase();
      return (
        (!q ||
          `${book.title} ${book.author ?? ''}`
            .toLocaleLowerCase()
            .includes(q)) &&
        (!filters.local || book.local === true) &&
        (filters.filter === 'all' ||
          (tab === 'catalog'
            ? book.level === filters.filter
            : filters.filter === 'finished'
              ? book.progress === 1
              : filters.filter === 'reading'
                ? (book.opened || (book.progress ?? 0) > 0) &&
                  book.progress !== 1
                : !book.opened && !book.progress))
      );
    })
    .sort((a, b) =>
      filters.sort === 'title'
        ? a.title.localeCompare(b.title)
        : filters.sort === 'added'
          ? (b.addedAt ?? 0) - (a.addedAt ?? 0)
          : filters.sort === 'level'
            ? (a.level ?? '').localeCompare(b.level ?? '') ||
              a.title.localeCompare(b.title)
            : 0
    );
  const levels = useMemo(
    () => [...new Set(catalog.map((book) => book.level))].sort(),
    [catalog]
  );
  const captureAnchor = (book: ShelfBook) => {
    const card = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[data-library-id]') ?? []
    ).find((el) => el.dataset.libraryId === book.id);
    useLibraryView.setState({
      anchor: {
        id: book.id,
        top: card?.getBoundingClientRect().top ?? 100,
        path: book.level ? location.pathname : '/library',
      },
    });
  };
  useEffect(() => {
    if (restored.current || currentStatus !== 'ready') return;
    const anchor = useLibraryView.getState().anchor;
    if (!anchor || anchor.path !== location.pathname) return;
    const target = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[data-library-id]') ?? []
    ).find((el) => el.dataset.libraryId === anchor.id);
    if (!target) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      target
        .querySelector<HTMLElement>('a,button')
        ?.focus({ preventScroll: true });
      window.scrollBy({
        top:
          target.getBoundingClientRect().top -
          Math.max(12, Math.min(anchor.top, window.innerHeight - 120)),
        behavior: 'instant',
      });
      target
        .querySelector<HTMLElement>('a')
        ?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [currentStatus, books, catalog, location.pathname]);
  const returnToShelf = () => {
    if (modal?.kind !== 'import' || !modal.book) return;
    useLibraryView.setState({
      anchor: { id: modal.book.id, top: 100, path: '/library' },
    });
    restored.current = false;
    setModal(null);
    navigate('/library');
    setRevision((v) => v + 1);
  };
  const close = () => {
    if (deleting || (modal?.kind === 'import' && modal.phase === 'committing'))
      return;
    abort.current?.abort();
    setModal(null);
  };
  const importFile = async (file: File) => {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const owner = captureDataScope();
    const current = () => owner() && !controller.signal.aborted;
    setModal({ kind: 'import', phase: 'processing', name: file.name });
    try {
      const { record } = await importBook(file, {
        signal: controller.signal,
        onCommit: () => {
          if (current())
            setModal({ kind: 'import', phase: 'committing', name: file.name });
        },
      });
      if (!current()) return;
      const book: ShelfBook = {
        ...record,
        href: `/library/${record.id}`,
        opened: false,
        progress: null,
        local: true,
      };
      useLibraryView.getState().reset('own');
      setModal({ kind: 'import', phase: 'success', book, name: file.name });
      void requestPersistence().then((value) => {
        if (current()) setPersisted(value);
      });
    } catch (error) {
      if (!current()) return;
      const code = error instanceof Error ? error.message : '';
      const quota =
        error instanceof DOMException && error.name === 'QuotaExceededError';
      const errorText =
        code === 'unsupported-format'
          ? ru
            ? 'Поддерживаются EPUB, FB2, DOCX и PDF.'
            : 'Choose an EPUB, FB2, DOCX or PDF file.'
          : code === 'pdf-no-text-layer'
            ? ru
              ? 'В PDF нет текстового слоя. Попробуйте EPUB или FB2.'
              : 'This PDF has no text layer. Try EPUB or FB2.'
            : quota
              ? ru
                ? 'Не хватило места. Освободите место на устройстве и повторите.'
                : 'Not enough storage. Free up space and retry.'
              : code === 'offline-storage-unavailable'
                ? ru
                  ? 'Браузер не поддерживает хранение книг.'
                  : 'This browser cannot store book files.'
                : ru
                  ? 'Не удалось открыть файл. Возможно, он повреждён или имеет неподдерживаемый формат.'
                  : 'Could not open the file. It may be damaged or in an unsupported format.';
      setModal({
        kind: 'import',
        phase: 'error',
        name: file.name,
        error: errorText,
      });
    }
  };
  const deleteSelected = async (book: ShelfBook) => {
    const owner = captureDataScope();
    setDeleting(true);
    setDeleteError('');
    try {
      await removeBook(book.id);
      if (!owner()) return;
      setModal(null);
      setMessage(
        ru
          ? `«${book.title}» удалена из библиотеки.`
          : `“${book.title}” removed from the library.`
      );
      requestAnimationFrame(() =>
        root.current?.querySelector<HTMLElement>('h1')?.focus()
      );
    } catch {
      if (owner())
        setDeleteError(
          ru
            ? 'Не удалось удалить книгу. Повторите попытку.'
            : 'Could not remove the book. Please retry.'
        );
    } finally {
      if (owner()) setDeleting(false);
    }
  };
  const toggleFinished = (book: ShelfBook) => {
    try {
      if (book.markedFinished)
        localStorage.removeItem('reader.' + book.id + '.finished');
      else localStorage.setItem('reader.' + book.id + '.finished', '1');
      setModal({
        kind: 'book',
        book: {
          ...book,
          markedFinished: !book.markedFinished,
          progress: book.markedFinished ? readProgress('reader.' + book.id) : 1,
        },
      });
      setDeleteError('');
    } catch {
      setDeleteError(
        ru
          ? 'Не удалось сохранить отметку на устройстве.'
          : 'Could not save the mark on this device.'
      );
    }
  };
  const openImport = () => {
    setMessage('');
    setModal({ kind: 'import', phase: 'choose' });
  };
  return (
    <section
      ref={root}
      className="library-page"
      aria-label={ru ? 'Библиотека' : 'Library'}
    >
      <BackToReader />
      <header className="library-head">
        <div>
          <h1 tabIndex={-1}>{ru ? 'Библиотека' : 'Library'}</h1>
          <p>
            {ru
              ? 'Читайте то, что интересно. Английский — между строк.'
              : 'Read what interests you. Learn English between the lines.'}
          </p>
        </div>
        {supported && (
          <Button onClick={openImport}>
            <PixelImage
              src="/assets/pixel/nav/library.png"
              alt=""
              className="h-5 w-5"
            />
            {ru ? 'Добавить книгу' : 'Add book'}
          </Button>
        )}
      </header>
      <input
        ref={inputRef}
        type="file"
        accept=".epub,.fb2,.fb2.zip,.docx,.pdf"
        aria-label={ru ? 'Файл книги' : 'Book file'}
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void importFile(file);
        }}
      />
      {resume && status === 'ready' && (
        <section
          className="library-continue"
          aria-labelledby="library-resume-title"
        >
          <BookCover book={resume} />
          <div>
            <p className="library-kicker">
              {ru ? 'Вернуться к истории' : 'Return to your story'}
            </p>
            <h2 id="library-resume-title">{resume.title}</h2>
            {resume.author && (
              <p className="text-muted text-sm">{resume.author}</p>
            )}
            <BookProgress book={resume} />
          </div>
          <div className="library-continue-actions">
            <Link
              to={resume.href}
              state={{ libraryReturn: location.pathname }}
              className="library-primary"
              onClick={() => captureAnchor(resume)}
            >
              {ru ? 'Продолжить чтение →' : 'Continue reading →'}
            </Link>
            <BookAvailability book={resume} />
          </div>
        </section>
      )}
      <nav
        className="library-nav"
        aria-label={ru ? 'Разделы библиотеки' : 'Library sections'}
      >
        <NavLink to="/library" end>
          {ru ? 'Мои книги' : 'My books'}{' '}
          <span>{status === 'ready' ? books.length : '…'}</span>
        </NavLink>
        <NavLink to="/library/catalog" end>
          {ru ? 'Каталог по уровню' : 'Catalog by level'}
        </NavLink>
      </nav>
      <div className="library-toolbar">
        <label className="library-search">
          <PixelImage
            src="/assets/pixel/nav/vocab.png"
            alt=""
            className="h-5 w-5"
          />
          <span className="sr-only">
            {ru ? 'Поиск по названию или автору' : 'Search by title or author'}
          </span>
          <input
            type="search"
            value={filters.query}
            onChange={(e) => view.update(tab, { query: e.target.value })}
            placeholder={ru ? 'Название или автор' : 'Title or author'}
          />
        </label>
        <label className="library-sort">
          {ru ? 'Порядок' : 'Order'}
          <select
            value={filters.sort}
            onChange={(e) => view.update(tab, { sort: e.target.value })}
          >
            {tab === 'own' ? (
              <>
                <option value="recent">
                  {ru ? 'Недавно открытые' : 'Recently opened'}
                </option>
                <option value="added">
                  {ru ? 'Недавно добавленные' : 'Recently added'}
                </option>
              </>
            ) : (
              <option value="level">{ru ? 'По уровню' : 'By level'}</option>
            )}
            <option value="title">{ru ? 'По названию' : 'By title'}</option>
          </select>
        </label>
      </div>
      <div className="library-filter-row">
        <div
          role="group"
          aria-label={ru ? 'Фильтр книг' : 'Book filter'}
          className="library-filters"
        >
          {(tab === 'own'
            ? [
                ['all', ru ? 'Все книги' : 'All books'],
                ['reading', ru ? 'Читаю' : 'Reading'],
                ['unread', ru ? 'Не начаты' : 'Not started'],
                ['finished', ru ? 'Прочитаны' : 'Finished'],
              ]
            : [
                ['all', ru ? 'Все уровни' : 'All levels'],
                ...levels.map((level) => [level, level]),
              ]
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-pressed={filters.filter === id}
              onClick={() => view.update(tab, { filter: id })}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="library-local">
          <input
            type="checkbox"
            checked={filters.local}
            onChange={(e) => view.update(tab, { local: e.target.checked })}
          />
          {ru ? 'Только на устройстве' : 'On this device only'}
        </label>
      </div>
      {tab === 'own' && (
        <>
          {!supported && (
            <Card className="mb-4">
              <p className="text-sm text-muted">
                {ru
                  ? 'Этот браузер не поддерживает хранение файлов книг. Попробуйте актуальный Chrome, Safari или Firefox.'
                  : 'This browser cannot store book files. Try a recent Chrome, Safari or Firefox.'}
              </p>
            </Card>
          )}
          {supported && !persisted && (
            <details className="library-storage-note">
              <summary>
                {ru ? 'Как не потерять книги' : 'Keep your books safe'}
              </summary>
              <p>
                {native
                  ? ru
                    ? 'Файлы книг лежат внутри приложения. Они пропадут, если удалить приложение или очистить его данные. При нехватке места система может вытеснить их. Включите синхронизацию для копии в облаке.'
                    : 'Book files live inside the app. Uninstalling it, clearing its data or running out of space can remove them. Enable sync to keep a cloud copy.'
                  : ru
                    ? 'Браузер не гарантирует сохранность файлов. Установите приложение на домашний экран (Поделиться → «На экран Домой») и храните исходные файлы отдельно.'
                    : 'The browser cannot guarantee file retention. Install the app on your home screen (Share → “Add to Home Screen”) and keep the original files.'}
              </p>
              <Link
                to={
                  '/settings/data?from=' + encodeURIComponent(location.pathname)
                }
              >
                {ru ? 'Настройки синхронизации →' : 'Sync settings →'}
              </Link>
            </details>
          )}
          {groupedIssues.map((issue) => (
            <GroupedUploadNotice key={issue} ru={ru} issue={issue} />
          ))}
        </>
      )}
      {currentStatus === 'loading' || checkingLocal ? (
        <div className="library-empty" role="status">
          <h2>{ru ? 'Загружаем книги…' : 'Loading books…'}</h2>
        </div>
      ) : currentStatus === 'error' ? (
        <div className="library-empty">
          <h2>{ru ? 'Не удалось загрузить книги' : 'Could not load books'}</h2>
          <p>
            {ru
              ? tab === 'own'
                ? 'Не удалось прочитать список на устройстве. Поиск и фильтры сохранены. Попробуйте ещё раз.'
                : 'Поиск и фильтры сохранены. Проверьте соединение и повторите.'
              : tab === 'own'
                ? 'Could not read the list on this device. Your search and filters are saved. Please retry.'
                : 'Your search and filters are saved. Check connectivity and retry.'}
          </p>
          <Button
            onClick={() =>
              tab === 'own'
                ? setRevision((v) => v + 1)
                : (setCatalogStatus('loading'), setCatalogRetry((v) => v + 1))
            }
          >
            {ru ? 'Повторить загрузку' : 'Retry loading'}
          </Button>
        </div>
      ) : all.length === 0 ? (
        <div className="library-empty">
          <PixelImage
            src="/assets/pixel/mascot.png"
            alt=""
            className="h-20 w-20"
          />
          <h2>
            {tab === 'own'
              ? ru
                ? 'Первая история ждёт вас'
                : 'Your first story awaits'
              : ru
                ? 'Каталог пока пуст'
                : 'The catalog is empty'}
          </h2>
          <p>
            {ru
              ? 'Добавьте свою книгу или выберите историю в каталоге. Читайте со словарём и озвучкой.'
              : 'Add your own book or pick a story from the catalog. Read with word lookup and audio.'}
          </p>
          <div className="library-actions">
            {supported && (
              <Button onClick={openImport}>
                {ru ? 'Добавить книгу' : 'Add book'}
              </Button>
            )}
            <Link to={tab === 'own' ? '/library/catalog' : '/library'}>
              {tab === 'own'
                ? ru
                  ? 'Открыть каталог'
                  : 'Open catalog'
                : ru
                  ? 'Мои книги'
                  : 'My books'}
            </Link>
          </div>
        </div>
      ) : filtered.length === 0 ? (
        <div className="library-empty">
          <h2>{ru ? 'Ничего не найдено' : 'No books found'}</h2>
          <p>
            {ru
              ? 'Попробуйте другое название, автора или условия поиска.'
              : 'Try another title, author or filter.'}
          </p>
          <Button variant="ghost" onClick={() => view.reset(tab)}>
            {ru ? 'Сбросить поиск и фильтры' : 'Reset search and filters'}
          </Button>
        </div>
      ) : (
        <>
          <div className="library-result-head">
            <h2>
              {tab === 'own'
                ? ru
                  ? 'Ваша книжная полка'
                  : 'Your bookshelf'
                : ru
                  ? 'Истории для вашего английского'
                  : 'Stories for your English'}
            </h2>
            <p role="status">
              {filtered.length} / {all.length} {ru ? 'книг' : 'books'}
            </p>
          </div>
          <div className="library-shelf">
            {filtered.map((book) => (
              <LibraryBook
                key={book.id}
                book={book}
                onOpen={() => captureAnchor(book)}
                onDetails={() => {
                  setDeleteError('');
                  setModal({ kind: 'book', book });
                }}
              >
                {tab === 'own' && (
                  <UploadIssueLine
                    ru={ru}
                    issue={issueFor(book.id)}
                    grouped={groupedIssues.some(
                      (issue) => issue === issueFor(book.id)
                    )}
                  />
                )}
              </LibraryBook>
            ))}
          </div>
        </>
      )}
      <p className="sr-only" role="status" aria-live="polite">
        {message}
      </p>
      <footer className="library-footer">
        <p>
          {tab === 'own'
            ? ru
              ? 'Нет подходящей книги под рукой? В каталоге есть короткие истории разных уровней.'
              : 'Nothing to read? Find short stories at different levels in the catalog.'
            : ru
              ? 'Уже есть книга? Добавьте EPUB, FB2, DOCX или PDF с текстовым слоем.'
              : 'Have a book? Add an EPUB, FB2, DOCX or a PDF with a text layer.'}
        </p>
        {tab === 'own' ? (
          <Link to="/library/catalog">
            {ru ? 'Подобрать по уровню →' : 'Choose by level →'}
          </Link>
        ) : (
          supported && (
            <Button variant="ghost" onClick={openImport}>
              {ru ? 'Добавить свою книгу' : 'Add your book'}
            </Button>
          )
        )}
      </footer>
      {modal && (
        <LibraryDialog
          modal={
            modal.kind !== 'import'
              ? {
                  ...modal,
                  book:
                    [...own, ...curated].find(
                      (book) => book.id === modal.book.id
                    ) ?? modal.book,
                }
              : modal
          }
          ru={ru}
          signedIn={signedIn}
          deleting={deleting}
          deleteError={deleteError}
          close={close}
          captureAnchor={captureAnchor}
          chooseFile={() => inputRef.current?.click()}
          setModal={setModal}
          deleteSelected={deleteSelected}
          toggleFinished={toggleFinished}
          returnToShelf={returnToShelf}
        />
      )}
    </section>
  );
}
