import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { BookRecord } from '@/db/db';
import { Button, Card, Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { importBook, listBooks, removeBook } from '@/features/reader/service';
import { opfsAvailable, requestPersistence } from '@/features/reader/storage';
import { RecommendedShelf } from '@/features/reader/RecommendedShelf';

export function LibraryPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const inputRef = useRef<HTMLInputElement>(null);
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [persisted, setPersisted] = useState(true);
  const supported = opfsAvailable();

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
      <Eyebrow className="mb-3.5">{ru ? 'библиотека' : 'library'}</Eyebrow>

      <RecommendedShelf />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{ru ? 'Мои книги' : 'My books'}</h1>
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

      {supported && !persisted && (
        <Card className="mb-4 border-amber-dim bg-amber-dim/10">
          <p className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
            {ru ? 'внимание' : 'heads up'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {ru
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

      {books.length === 0 ? (
        <p className="text-sm text-muted">
          {ru
            ? 'Пока пусто. Добавь книгу в EPUB, FB2, DOCX или PDF — и читай со словарём и озвучкой. PDF читается «как получится»: лучше всего EPUB/FB2.'
            : 'Nothing here yet. Add an EPUB, FB2, DOCX or PDF book and read it with lookup and audio. PDF is best-effort — EPUB/FB2 read best.'}
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {books.map((b) => (
            <Card key={b.id} className="flex items-center justify-between gap-3">
              <Link to={`/library/${b.id}`} className="min-w-0 flex-1">
                <p className="truncate font-semibold">{b.title}</p>
                <p className="truncate font-mono text-2xs uppercase tracking-[0.06em] text-muted">
                  {b.author ? `${b.author} · ` : ''}
                  {b.format} ·{' '}
                  {b.lastChapter > 0
                    ? ru
                      ? `глава ${b.lastChapter + 1}/${b.chapterCount}`
                      : `ch. ${b.lastChapter + 1}/${b.chapterCount}`
                    : `${b.chapterCount} ${ru ? 'глав' : 'ch.'}`}
                </p>
              </Link>
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
          ))}
        </div>
      )}
    </section>
  );
}
