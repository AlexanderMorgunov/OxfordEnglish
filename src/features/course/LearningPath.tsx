import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import type { CourseDay } from './model';
import { tr } from '@/features/i18n/uiLang';
import type { UiLang } from '@/features/i18n/uiLang';

export function LearningPath({
  days,
  selectedId,
  lang,
  progressKnown,
  onSelect,
  compact,
}: {
  days: CourseDay[];
  selectedId: string | undefined;
  lang: UiLang;
  progressKnown: boolean;
  onSelect: (entry: CourseDay) => void;
  compact: boolean;
}) {
  const ru = lang === 'ru';
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  const list = useRef<HTMLOListElement>(null);
  const [thread, setThread] = useState('');
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const update = () => {
      const root = element.getBoundingClientRect();
      const points = [...element.querySelectorAll('.course-station')].map(
        (node) => {
          const box = node.getBoundingClientRect();
          return {
            x: box.left + box.width / 2 - root.left,
            y: box.top + box.height / 2 - root.top,
          };
        }
      );
      setThread(
        points
          .map((point, i) => {
            const previous = points[i - 1];
            if (!previous) return `M${point.x},${point.y}`;
            const middle = (previous.y + point.y) / 2;
            return `C${previous.x},${middle} ${point.x},${middle} ${point.x},${point.y}`;
          })
          .join(' ')
      );
    };
    update();
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(element);
    element
      .querySelectorAll('li, .course-station')
      .forEach((node) => observer?.observe(node));
    window.addEventListener('resize', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [days, lang, selectedId, compact]);
  return (
    <div className="course-path-wrap">
      <svg className="course-thread" aria-hidden="true">
        <path d={thread} />
      </svg>
      <ol
        ref={list}
        className="course-path"
        aria-label={ru ? 'Дни блока по порядку' : 'Days in course order'}
      >
        {days.map((entry, index) => (
          <li key={entry.day.id}>
            <DayPathNode
              entry={entry}
              index={index}
              selected={entry.day.id === selectedId}
              compact={compact}
              progressKnown={progressKnown}
              lang={lang}
              onSelect={onSelect}
              to={`/course/${encodeURIComponent(entry.unit.id)}/day/${encodeURIComponent(entry.day.id)}${fromReader ? '?from=reader' : ''}`}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function DayPathNode({
  entry,
  index,
  selected,
  compact,
  progressKnown,
  lang,
  onSelect,
  to,
}: {
  entry: CourseDay;
  index: number;
  selected: boolean;
  compact: boolean;
  progressKnown: boolean;
  lang: UiLang;
  onSelect: (entry: CourseDay) => void;
  to: string;
}) {
  const node = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(false);
  // Selection and breakpoints can replace a focused button with a link or back.
  const preserveFocus = useCallback((element: HTMLElement | null) => {
    if (!element)
      restoreFocus.current = node.current === document.activeElement;
    else if (restoreFocus.current) {
      element.focus({ preventScroll: true });
      restoreFocus.current = false;
    }
    node.current = element;
  }, []);
  const ru = lang === 'ru';
  const { day, progress } = entry;
  const state = progressKnown ? progress.state : 'new';
  const props = {
    ref: preserveFocus,
    className: `course-day-node ${state} ${selected ? 'selected' : ''}`,
    'data-course-focus': `day:${day.id}`,
  };
  const content = (
    <>
      <span className="course-station" aria-hidden="true">
        <span>
          {state === 'done' ? '✓' : String(index + 1).padStart(2, '0')}
        </span>
      </span>
      <span className="course-day-copy">
        <span className="course-day-name">
          <span className="course-day-number">
            {ru ? 'День' : 'Day'} {index + 1}
          </span>
          {tr(day.title, lang)}
        </span>
        <span className="course-day-status">
          {state === 'done'
            ? ru
              ? 'Завершён'
              : 'Completed'
            : state === 'in-progress'
              ? ru
                ? 'В процессе'
                : 'In progress'
              : ru
                ? 'Доступен'
                : 'Available'}{' '}
          ·{' '}
          {state !== 'new'
            ? `${progress.completed}/${progress.total} ${ru ? 'верно' : 'correct'}`
            : `~${day.estimatedMinutes} ${ru ? 'мин' : 'min'}`}
        </span>
      </span>
      <span className="course-chevron" aria-hidden="true">
        ›
      </span>
    </>
  );
  return selected && !compact ? (
    <Link
      {...props}
      to={to}
      aria-current="step"
      title={ru ? 'Открыть день' : 'Open day'}
    >
      <span className="sr-only">{ru ? 'Открыть день: ' : 'Open day: '}</span>
      {content}
    </Link>
  ) : (
    <button
      {...props}
      type="button"
      aria-pressed={selected}
      aria-haspopup={compact ? 'dialog' : undefined}
      aria-controls={compact ? undefined : 'course-day-preview'}
      onClick={(event) => {
        event.currentTarget.focus({ preventScroll: true });
        onSelect(entry);
      }}
    >
      {content}
    </button>
  );
}
