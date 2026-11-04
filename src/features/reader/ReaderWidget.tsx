import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { NAVIGATION_INSETS_EVENT } from '@/shared/lib/navigation-insets';
import { useReaderSettings, RATE_STEPS } from './settings';
import { withReaderReturn } from './return-to-reader';
import { BookmarkList } from './BookmarkList';
import { ReaderAppearance } from './ReaderAppearance';
import { ReaderIcon } from './ReaderIcon';
import type { Bookmark } from './bookmarks';
import './reader-controls.css';

export type ReaderAudioControls = {
  available: boolean;
  active: boolean;
  engaged: boolean;
  onToggle: () => void;
  onStop: () => void;
  onNext: () => void;
  paragraphIndex?: number;
  sentenceIndex?: number;
};

const NAV = [
  {
    to: withReaderReturn('/vocabulary'),
    icon: 'cards',
    ru: 'Словарь',
    en: 'Vocabulary',
  },
  { to: withReaderReturn('/'), icon: 'grid', ru: 'Сегодня', en: 'Today' },
  {
    to: withReaderReturn('/grammar'),
    icon: 'sentence',
    ru: 'Грамматика',
    en: 'Grammar',
  },
  {
    to: withReaderReturn('/review'),
    icon: 'check',
    ru: 'Повторение',
    en: 'Review',
  },
  {
    to: withReaderReturn('/library'),
    icon: 'contents',
    ru: 'Библиотека',
    en: 'Library',
  },
] as const;

export function ReaderWidget({
  onBookmarkHere,
  bookmarks,
  progress,
  onJump,
  onDelete,
  audio,
  chapterLabel,
  bookProgress,
  onPreviousChapter,
  onNextChapter,
  onOpenContents,
  appearanceOpen: controlledAppearanceOpen,
  onAppearanceChange,
  appearanceReturnFocus,
}: {
  onBookmarkHere: () => Promise<{ added: boolean }>;
  bookmarks: Bookmark[];
  progress: Map<string, number>;
  onJump: (bm: Bookmark) => void;
  onDelete: (id: string) => void;
  audio?: ReaderAudioControls | null;
  chapterLabel?: string;
  bookProgress?: number;
  onPreviousChapter?: () => void;
  onNextChapter?: () => void;
  onOpenContents?: () => void;
  appearanceOpen?: boolean;
  onAppearanceChange?: (open: boolean) => void;
  appearanceReturnFocus?: () => HTMLElement | null;
}) {
  const speechAvailable = useSpeechAvailable();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const rate = useReaderSettings((s) => s.rate);
  const setRate = useReaderSettings((s) => s.setRate);
  const storageError = useReaderSettings((s) => s.storageError);
  const [open, setOpen] = useState(false);
  const [ownAppearanceOpen, setOwnAppearanceOpen] = useState(false);
  const appearanceOpen = controlledAppearanceOpen ?? ownAppearanceOpen;
  const [footerVisible, setFooterVisible] = useState(false);
  const [toast, setToast] = useState<{ text: string; error: boolean } | null>(
    null
  );
  const [bookmarkBusy, setBookmarkBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const appearanceBtnRef = useRef<HTMLButtonElement>(null);
  const toastTimer = useRef(0);
  const alive = useRef(true);
  const bookmarkPending = useRef(false);
  const panelId = useId();
  const canSpeak = audio?.available ?? speechAvailable;
  const playbackAvailable = Boolean(audio && canSpeak);
  const percentage =
    typeof bookProgress === 'number' && Number.isFinite(bookProgress)
      ? Math.round(Math.max(0, Math.min(1, bookProgress)) * 100)
      : null;

  const setAppearanceOpen = (next: boolean) => {
    setOwnAppearanceOpen(next);
    onAppearanceChange?.(next);
  };

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      window.clearTimeout(toastTimer.current);
    };
  }, []);

  useLayoutEffect(() => {
    const dock = dockRef.current;
    if (!dock) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue('--reader-dock-height');
    const publish = (height: string) => {
      if (root.style.getPropertyValue('--reader-dock-height') === height)
        return;
      if (height) root.style.setProperty('--reader-dock-height', height);
      else root.style.removeProperty('--reader-dock-height');
      window.dispatchEvent(new Event(NAVIGATION_INSETS_EVENT));
    };
    const update = () => {
      const rect = dock.getBoundingClientRect();
      const occupied =
        rect.height > 0
          ? Math.max(rect.height, window.innerHeight - rect.top)
          : 0;
      publish(`${footerVisible ? 0 : Math.ceil(occupied)}px`);
    };
    update();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(dock);
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      publish(previous);
    };
  }, [footerVisible]);

  useEffect(() => {
    const footer = document.querySelector('[data-app-footer]');
    if (!footer) return;
    const position = () => {
      const rect = footer.getBoundingClientRect();
      setFooterVisible(rect.height > 0 && rect.top < window.innerHeight);
    };
    position();
    const observer =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(position);
    observer?.observe(footer);
    const main = document.querySelector('main');
    if (main) observer?.observe(main);
    window.addEventListener('scroll', position, { passive: true });
    window.addEventListener('resize', position);
    return () => {
      observer?.disconnect();
      window.removeEventListener('scroll', position);
      window.removeEventListener('resize', position);
    };
  }, []);

  useEffect(() => {
    if (!footerVisible) return;
    setOpen(false);
    if (rootRef.current?.contains(document.activeElement)) {
      document
        .querySelector<HTMLElement>('main')
        ?.focus({ preventScroll: true });
    }
  }, [footerVisible]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const bookmarkHere = async () => {
    if (bookmarkPending.current) return;
    bookmarkPending.current = true;
    setBookmarkBusy(true);
    window.clearTimeout(toastTimer.current);
    try {
      const { added } = await onBookmarkHere();
      if (!alive.current) return;
      setOpen(false);
      setToast({
        text: added
          ? ru
            ? 'Закладка добавлена'
            : 'Bookmarked'
          : ru
            ? 'Закладка убрана'
            : 'Bookmark removed',
        error: false,
      });
    } catch {
      if (!alive.current) return;
      setToast({
        text: ru
          ? 'Не удалось сохранить закладку. Повторите попытку.'
          : 'Could not save the bookmark. Please try again.',
        error: true,
      });
    } finally {
      bookmarkPending.current = false;
      if (alive.current) {
        setBookmarkBusy(false);
        toastTimer.current = window.setTimeout(() => setToast(null), 5000);
      }
    }
  };

  return (
    <>
      <div
        ref={rootRef}
        className="rdc-widget"
        style={{ visibility: footerVisible ? 'hidden' : undefined }}
      >
        {toast && (
          <p
            className={`rdc-toast${toast.error ? ' rdc-error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
          >
            {toast.text}
          </p>
        )}
        {open && (
          <div id={panelId} className="rdc-actions-panel">
            <nav
              aria-label={ru ? 'Разделы' : 'Sections'}
              className="rdc-sections"
            >
              {NAV.map((item) => (
                <Link key={item.to} to={item.to} onClick={() => setOpen(false)}>
                  <ReaderIcon name={item.icon} />
                  <span>{ru ? item.ru : item.en}</span>
                </Link>
              ))}
            </nav>
            <button
              type="button"
              className="rdc-panel-action"
              disabled={bookmarkBusy}
              onClick={() => void bookmarkHere()}
            >
              <ReaderIcon name="bookmark" />
              {ru ? 'Добавить закладку' : 'Add bookmark'}
            </button>
            <button
              type="button"
              className="rdc-panel-action"
              aria-haspopup="dialog"
              onClick={() => {
                setOpen(false);
                setAppearanceOpen(true);
              }}
            >
              <ReaderIcon name="type" />
              {ru ? 'Вид текста' : 'Text appearance'}
            </button>
            {bookmarks.length > 0 && (
              <div className="rdc-bookmarks">
                <h2>
                  {ru ? 'Закладки' : 'Bookmarks'} ({bookmarks.length})
                </h2>
                <BookmarkList
                  bookmarks={bookmarks}
                  progress={progress}
                  onJump={(bm) => {
                    onJump(bm);
                    setOpen(false);
                  }}
                  onDelete={onDelete}
                />
              </div>
            )}
          </div>
        )}
        <div
          ref={dockRef}
          className="rdc-dock"
          role="region"
          aria-label={
            ru ? 'Озвучка и место в книге' : 'Read-aloud and book position'
          }
        >
          <div className="rdc-play-group">
            <button
              type="button"
              className="rdc-play-button"
              disabled={!playbackAvailable}
              onClick={() => audio?.onToggle()}
              aria-label={
                audio?.active
                  ? ru
                    ? 'Пауза'
                    : 'Pause reading'
                  : audio?.engaged
                    ? ru
                      ? 'Продолжить озвучку'
                      : 'Resume reading'
                    : ru
                      ? 'Слушать главу'
                      : 'Read chapter aloud'
              }
            >
              <ReaderIcon name={audio?.active ? 'pause' : 'play'} />
            </button>
            <div className="rdc-play-caption">
              <strong>
                {audio?.active
                  ? ru
                    ? 'Читаем вслух'
                    : 'Reading aloud'
                  : audio?.engaged
                    ? ru
                      ? 'На паузе'
                      : 'Paused'
                    : ru
                      ? 'Слушать главу'
                      : 'Listen to this chapter'}
              </strong>
              <span>
                {!canSpeak
                  ? ru
                    ? 'Озвучка недоступна'
                    : 'Speech unavailable'
                  : (chapterLabel ??
                    (ru ? 'С текущего места' : 'From your current position'))}
              </span>
            </div>
          </div>
          <div className="rdc-audio-controls">
            <button
              type="button"
              className="rdc-icon-button"
              disabled={!playbackAvailable || !audio?.engaged}
              onClick={() => audio?.onNext()}
              aria-label={ru ? 'Следующее предложение' : 'Next sentence'}
              title={ru ? 'Следующее предложение' : 'Next sentence'}
            >
              <ReaderIcon name="skip" />
            </button>
            <button
              type="button"
              className="rdc-icon-button"
              disabled={!playbackAvailable || !audio?.engaged}
              onClick={() => audio?.onStop()}
              aria-label={ru ? 'Остановить озвучку' : 'Stop reading'}
              title={ru ? 'Остановить озвучку' : 'Stop reading'}
            >
              <ReaderIcon name="stop" />
            </button>
            <label className="rdc-speed">
              <span className="sr-only">
                {ru ? 'Скорость озвучки' : 'Read-aloud speed'}
              </span>
              <select
                aria-label={ru ? 'Скорость озвучки' : 'Read-aloud speed'}
                disabled={!canSpeak}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
              >
                {RATE_STEPS.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </label>
          </div>
          {percentage !== null && (
            <div className="rdc-location">
              <span>
                {ru ? 'Место в книге' : 'Book position'} · {percentage}%
              </span>
              <progress
                aria-label={ru ? 'Место в книге' : 'Book position'}
                max={100}
                value={percentage}
              />
            </div>
          )}
          {(onPreviousChapter || onNextChapter) && (
            <div className="rdc-chapter-controls">
              <button
                type="button"
                className="rdc-icon-button"
                disabled={!onPreviousChapter}
                onClick={onPreviousChapter}
                aria-label={ru ? 'Предыдущая глава' : 'Previous chapter'}
              >
                <ReaderIcon name="chevron-left" />
              </button>
              <button
                type="button"
                className="rdc-icon-button"
                disabled={!onNextChapter}
                onClick={onNextChapter}
                aria-label={ru ? 'Следующая глава' : 'Next chapter'}
              >
                <ReaderIcon name="chevron-right" />
              </button>
            </div>
          )}
          {onOpenContents && (
            <button
              type="button"
              className="rdc-icon-button rdc-contents"
              onClick={onOpenContents}
              aria-label={ru ? 'Содержание' : 'Contents'}
            >
              <ReaderIcon name="contents" />
            </button>
          )}
          <button
            type="button"
            className="rdc-icon-button rdc-quick-bookmark"
            disabled={bookmarkBusy}
            onClick={() => void bookmarkHere()}
            aria-label={
              ru ? 'Закладка на текущем месте' : 'Bookmark current position'
            }
            title={
              ru ? 'Закладка на текущем месте' : 'Bookmark current position'
            }
          >
            <ReaderIcon name="bookmark" />
          </button>
          <button
            ref={appearanceBtnRef}
            type="button"
            className="rdc-icon-button"
            aria-label={ru ? 'Вид текста' : 'Text appearance'}
            title={ru ? 'Вид текста' : 'Text appearance'}
            aria-haspopup="dialog"
            onClick={() => setAppearanceOpen(true)}
          >
            <ReaderIcon name="type" />
          </button>
          <button
            ref={btnRef}
            type="button"
            className="rdc-icon-button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-label={ru ? 'Быстрые действия' : 'Quick actions'}
            title={ru ? 'Быстрые действия' : 'Quick actions'}
            onClick={() => setOpen((v) => !v)}
          >
            <ReaderIcon name={open ? 'close' : 'grid'} />
          </button>
          {storageError && !appearanceOpen && (
            <p className="rdc-storage-warning" role="status">
              {ru
                ? 'Настройки не сохранены в браузере.'
                : 'Preferences were not saved in this browser.'}
            </p>
          )}
          {!canSpeak && (
            <p className="rdc-unavailable">
              {ru
                ? 'Озвучка недоступна на этом устройстве.'
                : 'Read-aloud is unavailable on this device.'}
            </p>
          )}
        </div>
      </div>
      <ReaderAppearance
        open={appearanceOpen}
        onClose={() => setAppearanceOpen(false)}
        onBeforeVoicePreview={() => audio?.onStop()}
        returnFocus={() =>
          footerVisible
            ? document.querySelector<HTMLElement>('main')
            : (appearanceReturnFocus?.() ??
              appearanceBtnRef.current ??
              btnRef.current)
        }
      />
    </>
  );
}
