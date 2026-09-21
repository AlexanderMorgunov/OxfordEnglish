import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BookRecord } from '@/db/db';
import { Button, Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { importBook, listBooks, removeBook } from '@/features/reader/service';
import { opfsAvailable, requestPersistence } from '@/features/reader/storage';
import { isNativePlatform } from '@/shared/lib/platform';
import { useBookFileSync, useBookUploadIssues, type UploadIssue } from '@/features/reader/blobSync';
import { useAccount } from '@/features/account/store';
import { RecommendedShelf } from '@/features/reader/RecommendedShelf';
import { BackToReader } from '@/features/reader/BackToReader';
import { readProgress } from '@/features/stats/useReadingTracker';

/**
 * One reason usually covers several books at once — the account has no Pro, the cloud is full, the
 * connection is down — and repeating the same two-line explanation under each of them turns the library
 * into wallpaper. So a reason shared by MORE THAN ONE book is explained once above the list, and those
 * books only carry a short "which ones" marker. A reason that affects a single book stays on that book,
 * where it reads as the fact about that file it is.
 */
const ISSUE_ORDER = ['no-plan', 'quota', 'signed-out', 'error', 'too-large'] as const;
const PERMANENT: readonly UploadIssue[] = ['too-large', 'no-plan'];

const perBookText = (ru: boolean): Record<UploadIssue, string> =>
  ru
    ? {
        'too-large': 'Не уйдёт в облако: файл больше 20 МБ. На этом устройстве книга есть.',
        quota: 'Не уместилось в облако — место кончилось. Освободите его, и книга уйдёт сама.',
        'no-plan': 'Копия в облаке входит в Pro. Книга есть на этом устройстве.',
        error: 'Пока не ушло в облако. Попробуем ещё раз автоматически.',
        'signed-out': 'Пока не ушло в облако: не получается обновить вход.',
      }
    : {
        'too-large': 'Will not go to the cloud: over 20 MB. The book is here on this device.',
        quota: 'Did not fit in the cloud — it is full. Free some space and this goes up on its own.',
        'no-plan': 'A cloud copy is part of Pro. The book is here on this device.',
        error: 'Not in the cloud yet. We will try again automatically.',
        'signed-out': 'Not in the cloud yet: cannot refresh your sign-in.',
      };

const groupText = (ru: boolean): Record<UploadIssue, string> =>
  ru
    ? {
        'too-large': 'Отмеченные файлы больше 20 МБ — в облако они не уйдут. На этом устройстве книги есть.',
        quota: 'В облаке кончилось место, поэтому отмеченные книги не загрузились. Освободите место — они уйдут сами.',
        'no-plan': 'Копии книг в облаке входят в Pro. Отмеченные книги есть только на этом устройстве.',
        error: 'Отмеченные книги пока не ушли в облако. Попробуем ещё раз автоматически.',
        'signed-out': 'Не получается обновить вход, поэтому отмеченные книги пока не в облаке.',
      }
    : {
        'too-large': 'The marked files are over 20 MB, so they will not go to the cloud. The books are here on this device.',
        quota: 'The cloud is full, so the marked books did not upload. Free some space and they go up on their own.',
        'no-plan': 'Cloud copies of books are part of Pro. The marked books are only on this device.',
        error: 'The marked books are not in the cloud yet. We will try again automatically.',
        'signed-out': 'Cannot refresh your sign-in, so the marked books are not in the cloud yet.',
      };

function GroupedUploadNotice({ ru, issue }: { ru: boolean; issue: UploadIssue }) {
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
function UploadIssueLine({ ru, issue, grouped }: { ru: boolean; issue: UploadIssue | undefined; grouped: boolean }) {
  if (!issue) return null;
  const tone = PERMANENT.includes(issue) ? 'text-muted' : 'text-amber';
  // The cause is already stated once above; here the book only has to identify itself as one of them.
  if (grouped) return <p className={`mt-1 font-mono text-2xs ${tone}`}>{ru ? 'не в облаке' : 'not in the cloud'}</p>;
  return <p className={`mt-1 font-mono text-2xs ${tone}`}>{perBookText(ru)[issue]}</p>;
}

export function LibraryPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const issues = useBookUploadIssues((s) => s.issues);
  // `sweepBookFiles` only runs while signed in with the toggle on. Outside that, a marker would sit there
  // promising a retry with nothing retrying — so visibility is DERIVED rather than cleared on the way out:
  // turning the toggle back on brings the real answers straight back, instead of a ten-minute blank.
  const syncOn = useBookFileSync((s) => s.enabled);
  const signedIn = useAccount((s) => s.status === 'authenticated');
  const uploadsRunning = syncOn && signedIn;
  const issueFor = (id: string): UploadIssue | undefined => (uploadsRunning ? issues[id] : undefined);
  const inputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  // EVERY reason that covers more than one book gets its own line. Explaining only the biggest group
  // would leave the others showing a bare "not in the cloud" with the reason stated nowhere — worse than
  // the repetition this replaces. ISSUE_ORDER keeps the lines in a stable order.
  const counts = new Map<UploadIssue, number>();
  for (const b of books) {
    const i = issueFor(b.id);
    if (i) counts.set(i, (counts.get(i) ?? 0) + 1);
  }
  const groupedIssues = ISSUE_ORDER.filter((i) => (counts.get(i) ?? 0) > 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);
  const supported = opfsAvailable();
  const native = isNativePlatform();

  const reload = () => void listBooks().then(setBooks);
  useEffect(reload, []);
  useEffect(() => {
    if (supported) void navigator.storage.persisted?.().then((p) => setPersisted(p ?? true));
  }, [supported]);

  const onFile = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      await importBook(file);
      setPersisted(await requestPersistence());
      reload();
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';
      setError(
        msg === 'unsupported-format'
          ? ru
            ? 'Пока поддерживаются EPUB, FB2, DOCX и PDF.'
            : 'Only EPUB, FB2, DOCX and PDF are supported so far.'
          : msg === 'pdf-no-text-layer'
            ? ru
              ? 'В этом PDF нет текстового слоя (похоже на скан). Попробуй EPUB или FB2.'
              : 'This PDF has no text layer (looks scanned). Try EPUB or FB2 instead.'
            : msg === 'offline-storage-unavailable'
              ? ru
                ? 'Твой браузер не поддерживает офлайн-хранение книг.'
                : 'Your browser does not support offline book storage.'
              : ru
                ? 'Не удалось открыть файл — возможно, он повреждён или в неподдерживаемом формате.'
                : 'Could not open the file — it may be corrupt or in an unsupported format.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-label={ru ? 'Библиотека' : 'Library'}>
      <BackToReader />
      <Eyebrow className="mb-3.5">{ru ? 'библиотека' : 'library'}</Eyebrow>

      <RecommendedShelf />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <PixelImage src="/assets/pixel/nav/library.png" alt="" className="h-7 w-7 shrink-0" />
          <h1 className="text-2xl font-bold tracking-tight">{ru ? 'Мои книги' : 'My books'}</h1>
        </div>
        {supported && (
          <>
            <input
              ref={inputRef}
              type="file"
              accept=".epub,.fb2,.fb2.zip,.docx,.pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) void onFile(f);
              }}
            />
            <Button onClick={() => inputRef.current?.click()} disabled={busy}>
              {busy ? (ru ? 'Открываю…' : 'Importing…') : ru ? '+ Добавить книгу' : '+ Add book'}
            </Button>
          </>
        )}
      </div>

      {!supported && (
        <Card className="mb-4 border-amber-dim">
          <p className="text-sm text-muted">
            {ru
              ? 'Этот браузер не поддерживает офлайн-хранение книг. Открой приложение в Chrome, Safari (16.4+) или Firefox посвежее.'
              : 'This browser cannot store books offline. Open the app in Chrome, Safari 16.4+, or a recent Firefox.'}
          </p>
        </Card>
      )}

      {/*
        In the installed Android app `persist()` is always refused — that is what the WebView does,
        not a sign of anything wrong — so this card would be permanent there. Worse, its advice is
        impossible to follow: the app came from a store, and there is no "Add to Home Screen" to
        reach for. Same warning, honest remedy.
      */}
      {supported && !persisted && (
        <Card className="mb-4 border-amber-dim bg-amber-dim/10">
          <p className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
            {ru ? 'внимание' : 'heads up'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {native
              ? ru
                ? 'Файлы книг лежат внутри приложения. Они пропадут, если удалить приложение или очистить его данные — а при нехватке места система может вытеснить их и сама. Включите синхронизацию, чтобы книги хранились ещё и в облаке.'
                : 'Book files live inside the app. They go if the app is uninstalled or its data cleared — and the system may evict them on its own when storage runs short. Turn on sync to keep a copy in the cloud.'
              : ru
                ? 'Браузер не гарантирует сохранность файлов. Чтобы книги не пропали, установи приложение на домашний экран (Поделиться → «На экран Домой»).'
                : 'The browser will not guarantee your files survive. To keep your books, install the app to your home screen (Share → “Add to Home Screen”).'}
          </p>
        </Card>
      )}

      {error && (
        <Card className="mb-4 border-coral/40">
          <p className="text-sm text-coral">{error}</p>
        </Card>
      )}

      {groupedIssues.map((i) => (
        <GroupedUploadNotice key={i} ru={ru} issue={i} />
      ))}

      {books.length === 0 ? (
        <div className="text-center">
          <PixelImage src="/assets/pixel/mascot.png" alt="" className="mx-auto mb-4 h-24 w-24 opacity-90" />
          <p className="text-sm text-muted">
            {ru
              ? 'Пока пусто. Добавь книгу в EPUB, FB2, DOCX или PDF — и читай со словарём и озвучкой. PDF читается «как получится»: лучше всего EPUB/FB2.'
              : 'Nothing here yet. Add an EPUB, FB2, DOCX or PDF book and read it with lookup and audio. PDF is best-effort — EPUB/FB2 read best.'}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {books.map((b) => {
            const read = readProgress(`reader.${b.id}`);
            return (
              <Card key={b.id} className="flex items-center justify-between gap-3">
                {/* The issue line sits OUTSIDE the Link: it is not part of what the link does, and inside
                    it would be concatenated into the link's accessible name. */}
                <div className="min-w-0 flex-1">
                  <Link to={`/library/${b.id}`} className="block">
                    <p className="truncate font-semibold">{b.title}</p>
                    <p className="truncate font-mono text-2xs uppercase tracking-[0.06em] text-muted">
                      {b.author ? `${b.author} · ` : ''}
                      {b.format} ·{' '}
                      {read != null
                        ? `${ru ? 'прочитано' : 'read'} ${Math.round(read * 100)}%`
                        : `${b.chapterCount} ${ru ? 'глав' : 'ch.'}`}
                    </p>
                  </Link>
                  <UploadIssueLine ru={ru} issue={issueFor(b.id)} grouped={groupedIssues.some((i) => i === issueFor(b.id))} />
                </div>
                <button
                  type="button"
                  aria-label={ru ? 'Удалить' : 'Delete'}
                  className="shrink-0 font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-coral"
                  onClick={() => {
                    if (confirm(ru ? `Удалить «${b.title}»?` : `Delete “${b.title}”?`)) {
                      void removeBook(b.id).then(reload);
                    }
                  }}
                >
                  {ru ? 'удалить' : 'delete'}
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </section>
  );
}
