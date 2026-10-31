import { Link, useLocation } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { BookCover, BookProgress, BookAvailability } from './LibraryBook';
import type { ShelfBook } from './LibraryBook';

type ImportPhase = 'choose' | 'processing' | 'committing' | 'error' | 'success';
export type LibraryModal =
  | { kind: 'book' | 'delete'; book: ShelfBook }
  | {
      kind: 'import';
      phase: ImportPhase;
      name?: string;
      error?: string;
      book?: ShelfBook;
    };

export function LibraryDialog({
  modal,
  ru,
  signedIn,
  deleting,
  deleteError,
  close,
  captureAnchor,
  chooseFile,
  setModal,
  deleteSelected,
  toggleFinished,
  returnToShelf,
}: {
  modal: LibraryModal;
  ru: boolean;
  signedIn: boolean;
  deleting: boolean;
  deleteError: string;
  close: () => void;
  captureAnchor: (book: ShelfBook) => void;
  chooseFile: () => void;
  setModal: (modal: LibraryModal) => void;
  deleteSelected: (book: ShelfBook) => Promise<void>;
  toggleFinished: (book: ShelfBook) => void;
  returnToShelf: () => void;
}) {
  const book = modal.book;
  const location = useLocation();
  const title =
    modal.kind === 'import'
      ? modal.phase === 'success'
        ? ru
          ? 'Книга добавлена'
          : 'Book added'
        : ru
          ? 'Добавить книгу'
          : 'Add book'
      : modal.kind === 'delete'
        ? ru
          ? 'Удалить книгу?'
          : 'Remove this book?'
        : ru
          ? 'О книге'
          : 'About this book';
  return (
    <Dialog
      title={title}
      onClose={close}
      footer={
        modal.kind === 'import' ? (
          <>
            {modal.phase === 'success' && book && (
              <Link
                className="library-primary"
                to={book.href}
                state={{ libraryReturn: location.pathname }}
                onClick={() => captureAnchor(book)}
              >
                {ru ? 'Читать' : 'Read'}
              </Link>
            )}
            <Button
              variant="ghost"
              disabled={modal.phase === 'committing'}
              onClick={modal.phase === 'success' ? returnToShelf : close}
            >
              {modal.phase === 'success'
                ? ru
                  ? 'В библиотеку'
                  : 'Back to library'
                : ru
                  ? 'Отмена'
                  : 'Cancel'}
            </Button>
          </>
        ) : modal.kind === 'delete' && book ? (
          <>
            <Button
              variant="ghost"
              disabled={deleting}
              onClick={() => setModal({ kind: 'book', book })}
            >
              {ru ? 'Отмена' : 'Cancel'}
            </Button>
            <Button
              disabled={deleting}
              onClick={() => void deleteSelected(book)}
            >
              {deleting
                ? ru
                  ? 'Удаляем…'
                  : 'Removing…'
                : ru
                  ? 'Удалить книгу'
                  : 'Remove book'}
            </Button>
          </>
        ) : (
          book && (
            <>
              <Link
                className="library-primary"
                to={book.href}
                state={{ libraryReturn: location.pathname }}
                onClick={() => captureAnchor(book)}
              >
                {ru ? 'Читать' : 'Read'}
              </Link>
              <Button variant="ghost" onClick={close}>
                {ru ? 'Закрыть' : 'Close'}
              </Button>
              {!book.level && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setModal({ kind: 'delete', book });
                    requestAnimationFrame(() =>
                      document.querySelector<HTMLElement>('dialog h2')?.focus()
                    );
                  }}
                >
                  {ru ? 'Удалить книгу' : 'Remove book'}
                </Button>
              )}
            </>
          )
        )
      }
    >
      {modal.kind === 'import' ? (
        <div className="library-import">
          <p className="text-sm text-muted">
            {ru
              ? 'EPUB, FB2, DOCX и PDF. Для PDF нужен текстовый слой.'
              : 'EPUB, FB2, DOCX and PDF. PDFs need a text layer.'}
          </p>
          {modal.name && <p className="library-filename">{modal.name}</p>}
          {(modal.phase === 'processing' || modal.phase === 'committing') && (
            <p role="status">
              {modal.phase === 'processing'
                ? ru
                  ? 'Открываем и проверяем файл…'
                  : 'Opening and checking the file…'
                : ru
                  ? 'Сохраняем книгу…'
                  : 'Saving book…'}
            </p>
          )}
          {modal.phase === 'error' && (
            <p role="alert" className="text-coral">
              {modal.error}
            </p>
          )}
          {modal.phase === 'success' && (
            <p role="status">
              {ru
                ? 'Книга сохранена на этом устройстве.'
                : 'The book is saved on this device.'}
            </p>
          )}
          {['choose', 'error'].includes(modal.phase) && (
            <Button onClick={chooseFile}>
              {modal.phase === 'error'
                ? ru
                  ? 'Выбрать другой файл'
                  : 'Choose another file'
                : ru
                  ? 'Выбрать файл'
                  : 'Choose a file'}
            </Button>
          )}
          <p className="text-xs text-muted">
            {ru
              ? 'Большие файлы можно читать локально. Лимит облачной копии — 20 МБ на книгу.'
              : 'Large files can be read locally. Cloud copies are limited to 20 MB per book.'}
          </p>
        </div>
      ) : (
        book && (
          <>
            {modal.kind === 'delete' ? (
              <>
                <p className="font-semibold">{book.title}</p>
                <p className="mt-3 text-sm text-muted">
                  {signedIn
                    ? ru
                      ? 'Книга и её файл будут удалены с этого устройства. Удаление записи передастся на другие устройства при синхронизации. Мы также попробуем удалить облачный файл; без связи он может остаться в облаке. Исходный файл вне приложения сохранится.'
                      : 'The book and its file will be removed from this device. The deletion will sync to other devices. We will also try to remove the cloud file; if offline, it may remain there. Your original file outside the app stays intact.'
                    : ru
                      ? 'Книга и её файл будут удалены из приложения на этом устройстве. Исходный файл вне приложения сохранится.'
                      : 'The book and its file will be removed from the app on this device. Your original file outside the app stays intact.'}
                </p>
                {deleteError && (
                  <p role="alert" className="mt-3 text-coral">
                    {deleteError}
                  </p>
                )}
              </>
            ) : (
              <>
                <div className="library-detail">
                  <BookCover book={book} />
                  <div>
                    <h3>{book.title}</h3>
                    <p>{book.author}</p>
                    <p>{book.level ?? book.format?.toUpperCase()}</p>
                    <BookAvailability book={book} />
                  </div>
                </div>
                {!book.level && (
                  <>
                    <BookProgress book={book} />
                    {(book.markedFinished || book.progress !== 1) && (
                      <Button
                        variant="ghost"
                        className="mt-3"
                        onClick={() => toggleFinished(book)}
                      >
                        {book.markedFinished
                          ? ru
                            ? 'Вернуть в чтение'
                            : 'Return to reading'
                          : ru
                            ? 'Отметить прочитанной'
                            : 'Mark as read'}
                      </Button>
                    )}
                    {deleteError && (
                      <p role="alert" className="text-coral">
                        {deleteError}
                      </p>
                    )}
                  </>
                )}
                {book.local === false && !book.level && (
                  <p className="mt-4 text-sm text-muted">
                    {ru
                      ? 'Файла на этом устройстве нет. При открытии попробуем загрузить облачную копию. Если её нет, понадобится устройство, на котором добавили книгу.'
                      : 'The file is not on this device. Opening will try the cloud copy. If there is none, use the device where you added it.'}
                  </p>
                )}
                {book.level && (
                  <p className="mt-4 text-sm text-muted">
                    {ru
                      ? 'Книга из каталога со свободной лицензией. Сведения об источнике доступны в читалке.'
                      : 'A free-license catalog book. Source and attribution are available in the reader.'}
                  </p>
                )}
              </>
            )}
          </>
        )
      )}
    </Dialog>
  );
}
