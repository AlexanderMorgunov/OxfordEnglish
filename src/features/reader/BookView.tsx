import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  captureDataScope,
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { QuotaNotice } from '@/features/account/QuotaNotice';
import { Dialog } from '@/shared/ui/Dialog';
import { AppIcon } from '@/shared/ui/AppIcon';
import {
  saveProgress,
  useReadingTracker,
} from '@/features/stats/useReadingTracker';
import type { ParsedBook } from './parse';
import { paginateChapters } from './paginate';
import { ReadingText } from './reading-text';
import { ChapterStudy } from './ChapterStudy';
import { ChapterVocabulary } from './ChapterVocabulary';
import { ReaderHeader } from './ReaderHeader';
import { ReaderIcon } from './ReaderIcon';
import { ReaderWidget } from './ReaderWidget';
import type { ReaderAudioControls } from './ReaderWidget';
import { BookmarkList } from './BookmarkList';
import { buildBookIndex, positionOf, splitParas } from './position';
import { rememberReader, withReaderReturn } from './return-to-reader';
import { useReadingPosition } from './useReadingPosition';
import {
  listBookmarks,
  toggleBookmark,
  removeBookmark,
  snippetOf,
  locateBookmark,
} from './bookmarks';
import type { Bookmark } from './bookmarks';
import { currentReadingLocation } from './reader-location';
import { consumeWordReturn, currentWordReturn, discardWordReturn, useWordReturn } from './word-return';
import './reader.css';

type BookViewProps = {
  book: ParsedBook;
  idPrefix: string;
  initialChapter?: number;
  onChapter?: (index: number) => void | Promise<void>;
  remoteChapter?: number;
  libraryReturn?: string;
  level?: string;
};
const chapterAt = (value: number | undefined, count: number) =>
  Math.max(
    0,
    Math.min(Number.isFinite(value) ? Math.trunc(value!) : 0, count - 1)
  );
type Panel = 'contents' | 'bookmarks' | 'words' | 'exercises' | 'sections';

export function BookView(props: BookViewProps) {
  const revision = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision
  );
  const ru = useUiLang((s) => s.lang) === 'ru';
  if (!props.book.chapters.length)
    return (
      <section className="rd-empty">
        <h1>{ru ? 'В книге пока нет текста' : 'This book has no text'}</h1>
        <p>
          {ru
            ? 'Попробуйте добавить другой файл или вернитесь в библиотеку.'
            : 'Try another file or return to the library.'}
        </p>
        <Link to={props.libraryReturn ?? '/library'}>
          {ru ? 'К библиотеке' : 'Back to library'}
        </Link>
      </section>
    );
  return <BookSession key={`${props.idPrefix}:${revision}`} {...props} />;
}

function BookSession({
  book,
  idPrefix,
  initialChapter = 0,
  onChapter,
  remoteChapter,
  libraryReturn = '/library',
  level,
}: BookViewProps) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    t = (rus: string, en: string) => (ru ? rus : en);
  const { pathname } = useLocation();
  const chapters = useMemo(() => paginateChapters(book.chapters), [book]);
  const [chapter, setChapter] = useState(
    chapterAt(initialChapter, chapters.length)
  );
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]),
    [bookmarksState, setBookmarksState] = useState<
      'loading' | 'ready' | 'error'
    >('loading');
  const [panel, setPanel] = useState<Panel | null>(null),
    [appearanceOpen, setAppearanceOpen] = useState(false);
  const [bookmarkError, setBookmarkError] = useState(''),
    [chapterError, setChapterError] = useState('');
  const [audio, setAudio] = useState<ReaderAudioControls | null>(null),
    [bookProgress, setBookProgress] = useState(0);
  const [jump, setJump] = useState<{
    paragraph: number;
    sentence: number | null;
    nonce: number;
  } | null>(null);
  const [jumping, setJumping] = useState(false),
    [dismissedChapter, setDismissedChapter] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null),
    appearanceInvoker = useRef<HTMLElement | null>(null);
  const jumpingRef = useRef(false),
    active = useRef(true),
    bookmarkRead = useRef(0),
    nonceRef = useRef(0),
    chapterWrite = useRef(0);
  const writeQueue = useRef(Promise.resolve());
  const helpTargetId = useId();
  const wordReturn = useWordReturn(s => s.entry);
  const ch = chapters[chapter]!;
  const source = useMemo(
    () => ({ bookKey: idPrefix, chapterId: ch.id }),
    [idPrefix, ch.id]
  );
  const paragraphs = useMemo(() => splitParas(ch.text), [ch]);
  const bookIndex = useMemo(() => buildBookIndex(chapters), [chapters]);
  const cancelRestore = useReadingPosition({
    rootRef,
    jumpingRef,
    storageKey: `${idPrefix}.pos.${chapter}`,
    pageId: ch.id,
  });
  useEffect(() => {
    rememberReader(pathname);
  }, [pathname]);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const reloadBookmarks = useCallback(async () => {
    const read = ++bookmarkRead.current,
      current = captureDataScope();
    try {
      const rows = await listBookmarks(idPrefix, { strict: true });
      if (active.current && current() && bookmarkRead.current === read) {
        setBookmarks(rows);
        setBookmarksState('ready');
      }
    } catch {
      if (active.current && current() && bookmarkRead.current === read)
        setBookmarksState('error');
    }
  }, [idPrefix]);
  useEffect(() => {
    void reloadBookmarks();
  }, [reloadBookmarks]);
  const persistChapter = useCallback(
    (next: number) => {
      const write = ++chapterWrite.current,
        current = captureDataScope();
      writeQueue.current = writeQueue.current
        .catch(() => {})
        .then(async () => {
          if (!active.current || !current() || write !== chapterWrite.current)
            return;
          try {
            await onChapter?.(next);
            if (active.current && current() && write === chapterWrite.current)
              setChapterError('');
          } catch {
            if (active.current && current() && write === chapterWrite.current)
              setChapterError(
                ru
                  ? 'Не удалось сохранить главу. Попробуйте ещё раз.'
                  : 'The chapter could not be saved. Try again.'
              );
          }
        });
    },
    [onChapter, ru]
  );
  const go = (index: number) => {
    const next = chapterAt(index, chapters.length);
    if (next === chapter) {
      setPanel(null);
      return;
    }
    audio?.onStop();
    setAudio(null);
    setChapter(next);
    setPanel(null);
    persistChapter(next);
  };
  useEffect(() => {
    const entry = currentWordReturn();
    if (!entry || entry.kind !== 'book' || entry.phase !== 'ready' || entry.pathname !== pathname || entry.bookKey !== idPrefix) return;
    const index = chapters.findIndex(item => item.id === entry.chapterId);
    if (index < 0) { discardWordReturn(); return; }
    if (index !== chapter) {
      setChapter(index);
      persistChapter(index);
      return;
    }
    const frame = requestAnimationFrame(() => {
      if (currentWordReturn()?.id !== entry.id) return;
      const token = [...(rootRef.current?.querySelectorAll<HTMLButtonElement>('[data-reader-text] [data-widx]') ?? [])]
        .find(el => el.dataset.widx === entry.tokenId && el.textContent === entry.word);
      if (!token) { discardWordReturn(); return; }
      cancelRestore();
      token.scrollIntoView({ block: 'center' });
      if (token.getAttribute('aria-expanded') === 'true') consumeWordReturn(idPrefix, entry.chapterId, entry.tokenId, entry.word);
      else token.click();
      document.getElementById(token.getAttribute('aria-controls') ?? '')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [wordReturn, pathname, idPrefix, chapters, chapter, persistChapter, cancelRestore]);
  useEffect(() => {
    setBookProgress(positionOf(bookIndex, chapter, 0));
  }, [bookIndex, chapter]);
  useReadingTracker({
    bookKey: idPrefix,
    title: book.title,
    pageKey: ch.id,
    paragraphs,
    onPosition: (p) => {
      const position = positionOf(bookIndex, chapter, p);
      saveProgress(idPrefix, position);
      setBookProgress(position);
    },
  });
  useEffect(() => {
    if (!jump) return;
    const frame = requestAnimationFrame(() => {
      const text = rootRef.current?.querySelector('[data-reader-text]');
      const target =
        (jump.sentence != null
          ? text?.querySelector<HTMLElement>(
              `[data-sent="${jump.paragraph}:${jump.sentence}"]`
            )
          : null) ??
        text?.querySelector<HTMLElement>(`[data-para="${jump.paragraph}"]`);
      target?.scrollIntoView({
        block: 'start',
        behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)')
          .matches
          ? 'auto'
          : 'smooth',
      });
      if (target) {
        target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      jumpingRef.current = false;
      setJumping(false);
    });
    return () => cancelAnimationFrame(frame);
  }, [jump]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        document.querySelector('dialog[open]')
      )
        return;
      const target = event.target instanceof Element ? event.target : null;
      if (
        target?.closest(
          'button,a,input,textarea,select,summary,[contenteditable="true"]'
        ) ||
        window.getSelection()?.toString()
      )
        return;
      if (event.key === 'ArrowLeft' && chapter > 0) {
        event.preventDefault();
        go(chapter - 1);
      } else if (event.key === 'ArrowRight' && chapter < chapters.length - 1) {
        event.preventDefault();
        go(chapter + 1);
      } else if (event.code === 'Space' && audio?.available) {
        event.preventDefault();
        audio.onToggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const offered =
    remoteChapter == null || !Number.isFinite(remoteChapter) || jumping
      ? null
      : chapterAt(remoteChapter, chapters.length);
  const offer =
    offered != null && offered > chapter && offered !== dismissedChapter
      ? offered
      : null;
  const progress = useMemo(
    () =>
      new Map(
        bookmarks.map((bm) => {
          const loc = locateBookmark(chapters, bm);
          return [
            bm.id,
            positionOf(bookIndex, loc.page, loc.paragraph, loc.wordsIn),
          ];
        })
      ),
    [bookmarks, chapters, bookIndex]
  );
  const bookmarkedSentences = useMemo(
    () =>
      new Set(
        bookmarks
          .filter((bm) => bm.pageId === ch.id && bm.sentence != null)
          .map((bm) => `${bm.paragraph}:${bm.sentence}`)
      ),
    [bookmarks, ch.id]
  );
  const toggleSentenceBookmark = async (
    p: number,
    si: number,
    sentence: string
  ) => {
    const current = captureDataScope();
    setBookmarkError('');
    try {
      const result = await toggleBookmark(
        {
          bookKey: idPrefix,
          page: chapter,
          paragraph: p,
          sentence: si,
          pageId: ch.id,
          snippet: snippetOf(sentence),
          chapterTitle: ch.title,
          scrollY: Math.round(window.scrollY),
        },
        current
      );
      if (active.current && current()) await reloadBookmarks();
      return result;
    } catch (error) {
      if (active.current && current())
        setBookmarkError(
          t(
            'Не удалось изменить закладку. Попробуйте ещё раз.',
            'The bookmark could not be changed. Try again.'
          )
        );
      throw error;
    }
  };
  const toggleHere = async () => {
    const text =
      rootRef.current?.querySelector<HTMLElement>('[data-reader-text]');
    const location = text ? currentReadingLocation(text, paragraphs) : null;
    if (!location) throw new Error('No reading position');
    return toggleSentenceBookmark(
      location.paragraph,
      location.sentence,
      location.text
    );
  };
  const jumpTo = (bm: Bookmark) => {
    audio?.onStop();
    cancelRestore();
    const { page, paragraph, sentence } = locateBookmark(chapters, bm);
    jumpingRef.current = true;
    setJumping(true);
    setJump({ paragraph, sentence, nonce: ++nonceRef.current });
    go(page);
    setPanel(null);
  };
  const deleteBookmark = async (id: string) => {
    const current = captureDataScope();
    await removeBookmark(id, current);
    if (active.current && current()) await reloadBookmarks();
  };
  const appearance = (open: boolean) => {
    if (open)
      appearanceInvoker.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
    setAppearanceOpen(open);
  };
  const chapterTitle =
    ch.title ?? t(`Глава ${chapter + 1}`, `Chapter ${chapter + 1}`);
  const contents = (
    <nav
      className="rd-chapter-list"
      aria-label={t('Главы книги', 'Book chapters')}
    >
      {chapters.map((item, index) => (
        <button
          type="button"
          key={item.id}
          aria-current={chapter === index ? 'page' : undefined}
          onClick={() => go(index)}
        >
          <small>{index + 1}</small>
          <span>
            {item.title ?? t(`Глава ${index + 1}`, `Chapter ${index + 1}`)}
          </span>
        </button>
      ))}
    </nav>
  );
  const titles = {
    contents: t('Содержание', 'Contents'),
    bookmarks: t('Закладки', 'Bookmarks'),
    words: t('Слова и практика', 'Words and practice'),
    exercises: t('Упражнения по главе', 'Chapter exercises'),
    sections: t('Разделы', 'Sections'),
  };
  const sections = [
    ['/', t('Сегодня', 'Today')],
    ['/grammar', t('Грамматика', 'Grammar')],
    ['/review', t('Повторение', 'Review')],
    ['/vocabulary', t('Словарь', 'Vocabulary')],
    ['/library', t('Библиотека', 'Library')],
    ['/progress', t('Прогресс', 'Progress')],
    ['/settings', t('Настройки', 'Settings')],
    ['/pro', 'Pro'],
    ['/feedback', t('Обратная связь', 'Feedback')],
    ['/about', t('О приложении', 'About')],
  ];
  return (
    <div className="rd-book-view" ref={rootRef}>
      <ReaderHeader
        title={book.title}
        chapter={chapter}
        total={chapters.length}
        libraryReturn={libraryReturn}
        bookmarkCount={bookmarksState === 'ready' ? bookmarks.length : null}
        onContents={() => setPanel('contents')}
        onBookmarks={() => setPanel('bookmarks')}
        onAppearance={() => appearance(true)}
        onSections={() => setPanel('sections')}
      />
      <div className="rd-reading-grid">
        <aside
          className="rd-book-rail"
          aria-label={t('Книга и содержание', 'Book and contents')}
        >
          <div className="rd-book-cover" aria-hidden="true">
            <AppIcon name="today" />
            <p>{book.title}</p>
            {book.author && <small>{book.author}</small>}
          </div>
          {level && (
            <p className="rd-rail-caption">
              {t('Уровень', 'Level')} {level}
            </p>
          )}
          {contents}
          <button
            type="button"
            className="rd-rail-practice"
            onClick={() => setPanel('words')}
          >
            <ReaderIcon name="cards" />
            {t('Слова этой главы', 'Words from this chapter')}
          </button>
          <p className="rd-rail-note">
            {t(
              'В своём темпе. По одной истории за раз.',
              'At your own pace. One story at a time.'
            )}
          </p>
        </aside>
        <section
          className="rd-reading-main"
          aria-label={t('Текст книги', 'Book text')}
        >
          {offer != null && (
            <div className="rd-remote-offer" role="status">
              <p>
                {t(
                  `На другом устройстве вы читали дальше — глава ${offer + 1}.`,
                  `You were further along on another device — chapter ${offer + 1}.`
                )}
              </p>
              <div className="rd-actions">
                <button
                  type="button"
                  className="rd-btn rd-primary"
                  onClick={() => go(offer)}
                >
                  {t('Перейти', 'Go there')}
                </button>
                <button
                  type="button"
                  className="rd-btn"
                  onClick={() => setDismissedChapter(offer)}
                >
                  {t('Остаться', 'Stay')}
                </button>
              </div>
            </div>
          )}
          {chapterError && (
            <div className="rd-error" role="alert">
              <p>{chapterError}</p>
              <button
                type="button"
                className="rd-text-button"
                onClick={() => persistChapter(chapter)}
              >
                {t('Повторить', 'Retry')}
              </button>
            </div>
          )}
          {bookmarkError && (
            <p className="rd-error" role="alert">
              {bookmarkError}
            </p>
          )}
          <div className="rd-reading-surface">
            <p className="rd-chapter-kicker">
              {t(
                `Глава ${chapter + 1} из ${chapters.length}`,
                `Chapter ${chapter + 1} of ${chapters.length}`
              )}
            </p>
            <h1 tabIndex={-1}>{chapterTitle}</h1>
            <p className="rd-reading-hint">
              {t(
                'Нажмите слово, чтобы посмотреть значение. Значок рядом с предложением открывает перевод и разбор.',
                'Tap a word for its meaning. The icon beside a sentence opens translation and explanation.'
              )}
            </p>
            <QuotaNotice compact />
            {ch.text.trim() ? (
              <ReadingText
                key={`${idPrefix}:${chapter}:${ch.id}`}
                paragraphs={paragraphs}
                source={source}
                helpTargetId={helpTargetId}
                onAudioControlsChange={setAudio}
                bookmarkedSentences={bookmarkedSentences}
                onBookmarkSentence={(p, si, text) => {
                  void toggleSentenceBookmark(p, si, text).catch(() => {});
                }}
              />
            ) : (
              <p className="rd-empty-chapter">
                {t(
                  'В этой главе нет текста. Выберите другую главу.',
                  'This chapter has no text. Choose another chapter.'
                )}
              </p>
            )}
          </div>
          <section className="rd-chapter-finish">
            <div>
              <h2>{t('Остановиться на минуту?', 'Take a moment?')}</h2>
              <p>
                {t(
                  'Закрепите слова, которые встретились в этой главе.',
                  'Practise the words you met in this chapter.'
                )}
              </p>
            </div>
            <div className="rd-actions">
              <button
                type="button"
                className="rd-btn"
                onClick={() => setPanel('words')}
              >
                <ReaderIcon name="cards" />
                {t('Слова и практика', 'Words and practice')}
              </button>
              <button
                type="button"
                className="rd-text-button"
                disabled={!ch.text.trim()}
                onClick={() => setPanel('exercises')}
              >
                {t('Упражнения по главе', 'Chapter exercises')}
              </button>
            </div>
          </section>
          <nav
            className="rd-chapter-paging"
            aria-label={t('Переход по главам', 'Chapter navigation')}
          >
            <button
              type="button"
              className="rd-btn"
              disabled={chapter === 0}
              onClick={() => go(chapter - 1)}
            >
              <ReaderIcon name="back" />
              {t('Предыдущая', 'Previous')}
            </button>
            <span>
              {chapter + 1} / {chapters.length}
            </span>
            <button
              type="button"
              className="rd-btn"
              disabled={chapter >= chapters.length - 1}
              onClick={() => go(chapter + 1)}
            >
              {t('Следующая глава', 'Next chapter')}
              <ReaderIcon name="arrow" />
            </button>
          </nav>
        </section>
        <aside
          id={helpTargetId}
          className="rd-assist-rail"
          aria-label={t('Помощь с чтением', 'Reading help')}
        />
      </div>
      {panel && (
        <Dialog
          title={titles[panel]}
          onClose={() => setPanel(null)}
          size={
            panel === 'words' || panel === 'exercises' ? 'wide' : 'standard'
          }
        >
          {panel === 'contents' && (
            <>
              <p className="rd-dialog-book-title">{book.title}</p>
              {contents}
            </>
          )}
          {panel === 'bookmarks' && (
            <>
              {bookmarksState === 'loading' && (
                <p role="status">
                  {t('Загружаем закладки…', 'Loading bookmarks…')}
                </p>
              )}
              {bookmarksState === 'error' && (
                <p role="alert">
                  {t(
                    'Не удалось загрузить закладки.',
                    'Bookmarks could not be loaded.'
                  )}{' '}
                  <button
                    type="button"
                    className="rd-text-button"
                    onClick={() => void reloadBookmarks()}
                  >
                    {t('Повторить', 'Retry')}
                  </button>
                </p>
              )}
              {bookmarksState === 'ready' && (
                <BookmarkList
                  bookmarks={bookmarks}
                  progress={progress}
                  onJump={jumpTo}
                  onDelete={deleteBookmark}
                />
              )}
            </>
          )}
          {panel === 'words' && (
            <ChapterVocabulary
              key={`${idPrefix}:${ch.id}`}
              source={source}
              embedded
            />
          )}
          {panel === 'exercises' && (
            <ChapterStudy
              text={ch.text}
              idPrefix={`${idPrefix}.${chapter}`}
              embedded
            />
          )}
          {panel === 'sections' && (
            <nav
              className="rd-sections"
              aria-label={t('Разделы приложения', 'App sections')}
            >
              {sections.map(([path, label]) => (
                <Link key={path} to={withReaderReturn(path!)}>
                  {label}
                </Link>
              ))}
            </nav>
          )}
        </Dialog>
      )}
      <ReaderWidget
        onBookmarkHere={toggleHere}
        bookmarks={bookmarks}
        progress={progress}
        onJump={jumpTo}
        onDelete={deleteBookmark}
        audio={audio}
        chapterLabel={t(
          `Глава ${chapter + 1} из ${chapters.length}`,
          `Chapter ${chapter + 1} of ${chapters.length}`
        )}
        bookProgress={bookProgress}
        onPreviousChapter={chapter > 0 ? () => go(chapter - 1) : undefined}
        onNextChapter={
          chapter < chapters.length - 1 ? () => go(chapter + 1) : undefined
        }
        onOpenContents={() => setPanel('contents')}
        appearanceOpen={appearanceOpen}
        onAppearanceChange={appearance}
        appearanceReturnFocus={() => appearanceInvoker.current}
      />
    </div>
  );
}
