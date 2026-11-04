import { useId } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { tr } from '@/features/i18n/uiLang';
import type { UiLang } from '@/features/i18n/uiLang';
import type { CourseDay } from './model';

const sections = {
  grammar: ['Грамматика', 'Grammar'],
  vocabulary: ['Лексика', 'Vocabulary'],
  reading: ['Чтение', 'Reading'],
  listening: ['Аудирование', 'Listening'],
  practice: ['Практика', 'Practice'],
};

export function DayPreview({
  entry,
  lang,
  progressKnown,
  onOpen,
  inDialog = false,
}: {
  entry: CourseDay;
  lang: UiLang;
  progressKnown: boolean;
  onOpen?: () => void;
  inDialog?: boolean;
}) {
  const ru = lang === 'ru';
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  const { day, unit, progress } = entry;
  const titleId = useId();
  const done = progressKnown && progress.state === 'done';
  return (
    <article className="course-day-detail" aria-labelledby={titleId}>
      <div className="course-detail-top">
        <p className="course-detail-kicker">
          {ru
            ? `Выбранный день ${unit.days.indexOf(day) + 1} из ${unit.days.length}`
            : `Selected day ${unit.days.indexOf(day) + 1} of ${unit.days.length}`}
          <PixelImage
            src="/assets/pixel/sections/reading.png"
            alt=""
            className="h-8 w-8 shrink-0"
          />
        </p>
        <h3 id={titleId}>{tr(day.title, lang)}</h3>
        {ru && day.title.en !== day.title.ru && (
          <p lang="en" className="course-muted">
            {day.title.en}
          </p>
        )}
      </div>
      <div className="course-detail-body">
        <div className="course-solved-line">
          <span
            className={
              done
                ? 'text-teal'
                : progress.state === 'in-progress'
                  ? 'text-amber'
                  : ''
            }
          >
            {!progressKnown
              ? ru
                ? 'Прогресс недоступен'
                : 'Progress unavailable'
              : done
                ? ru
                  ? '✓ Завершён'
                  : '✓ Completed'
                : progress.state === 'in-progress'
                  ? ru
                    ? '◐ В процессе'
                    : '◐ In progress'
                  : ru
                    ? '○ Доступен'
                    : '○ Available'}
          </span>
          {progressKnown && progress.total > 0 && (
            <strong>
              {ru
                ? `${progress.completed} из ${progress.total} верно`
                : `${progress.completed} of ${progress.total} correct`}
            </strong>
          )}
        </div>
        {progressKnown && progress.total > 0 && (
          <div
            className="course-meter"
            role="progressbar"
            aria-label={
              ru
                ? 'Правильно решённые упражнения'
                : 'Correctly solved exercises'
            }
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.completed}
          >
            <span
              className={done ? 'is-done' : ''}
              style={{
                width: `${(progress.completed / progress.total) * 100}%`,
              }}
            />
          </div>
        )}
        {progress.total === 0 && (
          <p className="course-muted">
            {ru
              ? 'Материалы без оцениваемых упражнений. Чтение не отмечает день завершённым.'
              : 'Materials without scored exercises. Reading does not mark the day complete.'}
          </p>
        )}
        <p className="course-detail-meta">
          ~{day.estimatedMinutes}{' '}
          {ru ? 'мин на весь день' : 'min for the whole day'} ·{' '}
          {day.sections.length} {ru ? 'разделов' : 'sections'}
        </p>
        <details className="course-sections" open={!inDialog}>
          <summary>{ru ? 'Что внутри дня' : 'Inside this day'}</summary>
          <ul>
            {day.sections.map((section) => (
              <li key={section.id}>
                <PixelImage
                  src={`/assets/pixel/sections/${section.type}.png`}
                  alt=""
                  className="h-5 w-5 shrink-0"
                />
                <div>
                  <small>{sections[section.type][ru ? 0 : 1]}</small>
                  {tr(section.title, lang)}
                </div>
              </li>
            ))}
          </ul>
        </details>
        <Link
          to={`/course/${encodeURIComponent(unit.id)}/day/${encodeURIComponent(day.id)}${fromReader ? '?from=reader' : ''}`}
          onClick={onOpen}
          data-course-focus={`open:${day.id}`}
          className="course-button course-open-day"
        >
          {done
            ? ru
              ? 'Повторить день'
              : 'Revisit day'
            : ru
              ? 'Открыть выбранный день'
              : 'Open selected day'}
        </Link>
        <p className="course-detail-id">
          {day.id} ·{' '}
          {ru ? 'прогресс по верным ответам' : 'progress from correct answers'}
        </p>
      </div>
    </article>
  );
}
