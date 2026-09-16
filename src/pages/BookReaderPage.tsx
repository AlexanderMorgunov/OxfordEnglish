import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { BookRecord } from '@/db/db';
import { Button, Eyebrow, PageStub } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { getBook, openBook, saveProgress, BookFileUnavailable } from '@/features/reader/service';
import { opfsAvailable } from '@/features/reader/storage';
import { useBookFileSync, type BookFileIssue } from '@/features/reader/blobSync';
import type { ParsedBook } from '@/features/reader/parse';
import { BookView } from '@/features/reader/BookView';

/**
 * Everything that can go wrong opening a book used to arrive as one sentence. The distinction that
 * matters most is whether THIS device can do anything about it: a missing cloud copy has to be uploaded
 * from the device the book was added on, and no button here will ever change that.
 */
type Failure =
  | { kind: 'not-found' }
  | { kind: 'no-storage' }
  | { kind: 'unreadable' }
  | { kind: 'file'; issue: BookFileIssue };

function explain(f: Failure, ru: boolean, syncOn: boolean): { title: string; body: string; retry: boolean } {
  if (f.kind === 'not-found') {
    return {
      title: ru ? 'Книга не найдена' : 'Book not found',
      body: ru ? 'Возможно, её удалили на другом устройстве.' : 'It may have been removed on another device.',
      retry: false,
    };
  }
  if (f.kind === 'no-storage') {
    return {
      title: ru ? 'Браузер не даёт хранить книги' : 'This browser cannot store books',
      body: ru
        ? 'Установите приложение на домашний экран — тогда файлы книг будут храниться надёжно.'
        : 'Install the app to your home screen and book files will be stored reliably.',
      retry: false,
    };
  }
  if (f.kind === 'unreadable') {
    return {
      title: ru ? 'Файл книги не читается' : 'The book file is unreadable',
      body: ru
        ? 'Файл повреждён или в неподдерживаемом формате. Удалите книгу из библиотеки и добавьте заново.'
        : 'The file is damaged or in an unsupported format. Remove the book from the library and add it again.',
      retry: false,
    };
  }
  const byIssue: Record<BookFileIssue, { title: string; body: string; retry: boolean }> = {
    'signed-out': {
      title: ru ? 'Нужен вход в аккаунт' : 'Sign in required',
      body: ru
        ? 'Файл этой книги хранится в облаке. Войдите в аккаунт в настройках, чтобы загрузить его.'
        : 'This book’s file lives in the cloud. Sign in from settings to fetch it.',
      retry: true,
    },
    // Deliberately not "not yet, try again": the bytes exist only on the device the book was added on,
    // and until that device uploads them, nothing here can succeed. Saying otherwise sends people to
    // tap a button that cannot work.
    'not-uploaded': {
      title: ru ? 'Файл книги сюда ещё не приехал' : 'This book’s file is not here yet',
      // The advice differs by which half of the problem the user is in, and getting it wrong sends
      // someone to flip a setting that is already on.
      body: syncOn
        ? ru
          ? 'Книга добавлена на другом устройстве, а её файл в облако пока не попал. Откройте приложение на том устройстве при включённом интернете — файл загрузится сам, и книга откроется здесь.'
          : 'The book was added on another device and its file has not reached the cloud. Open the app on that device while online — it uploads by itself, and the book will open here.'
        : ru
          ? 'Загрузка файлов книг выключена, поэтому в облако попадают только сведения о книге, но не сам файл. Включите «Синхронизировать файлы книг» в настройках аккаунта — настройка общая для всех ваших устройств.'
          : 'Uploading book files is off, so only the book’s details reach the cloud, never the file itself. Turn on “Sync book files” in account settings — it applies to all your devices.',
      retry: false,
    },
    offline: {
      title: ru ? 'Нет связи' : 'You are offline',
      body: ru
        ? 'Файла этой книги на этом устройстве ещё нет, а скачать его сейчас не получается.'
        : 'This device does not have the book’s file yet, and it cannot be fetched right now.',
      retry: true,
    },
    'download-failed': {
      title: ru ? 'Не удалось скачать файл' : 'The download failed',
      body: ru ? 'Попробуйте ещё раз — ссылка на загрузку могла устареть.' : 'Try again — the download link may have expired.',
      retry: true,
    },
    'no-space': {
      title: ru ? 'Не хватило места' : 'Not enough room',
      body: ru
        ? 'Файл скачался, но сохранить его на этом устройстве не вышло. Освободите место и попробуйте снова.'
        : 'The file downloaded but could not be stored on this device. Free up space and try again.',
      retry: true,
    },
  };
  return byIssue[f.issue];
}

export function BookReaderPage() {
  const { bookId } = useParams();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const syncOn = useBookFileSync((s) => s.enabled);
  const [record, setRecord] = useState<BookRecord | null>(null);
  const [book, setBook] = useState<ParsedBook | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);
  // Retry has to be able to re-run the effect, so the attempt counter is part of its deps.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let alive = true;
    if (!bookId) return;
    setLoading(true);
    setFailure(null);
    void (async () => {
      try {
        const rec = await getBook(bookId);
        if (!rec) throw new BookNotFound();
        const parsed = await openBook(rec);
        if (!alive) return;
        setRecord(rec);
        setBook(parsed);
      } catch (e) {
        if (!alive) return;
        if (e instanceof BookNotFound) setFailure({ kind: 'not-found' });
        else if (e instanceof BookFileUnavailable) setFailure({ kind: 'file', issue: e.issue });
        else if (!opfsAvailable()) setFailure({ kind: 'no-storage' });
        else setFailure({ kind: 'unreadable' });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [bookId, attempt]);

  if (loading) return <p className="font-mono text-sm text-muted">loading book…</p>;
  if (failure || !book || !record) {
    const { title, body, retry } = explain(failure ?? { kind: 'unreadable' }, ru, syncOn);
    return (
      <PageStub eyebrow="library" title={title}>
        <p className="mb-4 max-w-prose text-sm leading-relaxed text-pretty text-muted">{body}</p>
        <div className="flex flex-wrap items-center gap-3">
          {retry && (
            <Button size="sm" onClick={() => setAttempt((n) => n + 1)}>
              {ru ? 'Попробовать снова' : 'Try again'}
            </Button>
          )}
          <Link to="/library" className="font-mono text-teal hover:underline">
            ← {ru ? 'к библиотеке' : 'back to library'}
          </Link>
        </div>
      </PageStub>
    );
  }

  return (
    <article>
      <div className="mb-3.5 flex items-center justify-between gap-3">
        <Eyebrow>{book.title}</Eyebrow>
        <Link to="/library" className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline">
          ← {ru ? 'библиотека' : 'library'}
        </Link>
      </div>
      <BookView
        book={book}
        idPrefix={`reader.${record.id}`}
        initialChapter={record.lastChapter}
        onChapter={(i) => void saveProgress(record.id, i)}
      />
    </article>
  );
}

class BookNotFound extends Error {}
