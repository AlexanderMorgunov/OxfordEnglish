import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ContentLoadError } from '@/content/ContentLoadError';
import { Button } from '@/shared/ui';
import { tr } from '@/features/i18n/uiLang';
import {
  getDataOwnerRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { BackToReader } from '@/features/reader/BackToReader';
import { CourseResume } from '@/features/course/CourseResume';
import { countLabel, unitLevel } from '@/features/course/model';
import type { CourseLevel } from '@/features/course/model';
import { useCourseData } from '@/features/course/useCourseData';
import { useCourseNavigation } from '@/features/course/navigation';
import { useBrowsePosition } from '@/features/course/useBrowsePosition';
import '@/features/course/course.css';

const levelCopy: Record<
  CourseLevel,
  { ru: [string, string]; en: [string, string] }
> = {
  A1: {
    ru: ['Первые шаги', 'Знакомство, дом, семья и повседневные дела.'],
    en: ['First steps', 'Introductions, home, family and everyday activities.'],
  },
  A2: {
    ru: [
      'Повседневное общение',
      'Истории, планы и знакомые жизненные ситуации.',
    ],
    en: [
      'Everyday communication',
      'Stories, plans and familiar everyday situations.',
    ],
  },
  B1: {
    ru: ['Больше самостоятельности', 'Опыт, мнения и связанные рассказы.'],
    en: ['More independence', 'Experiences, opinions and connected stories.'],
  },
  B2: {
    ru: ['Точнее выражать мысли', 'Оттенки смысла и сложные конструкции.'],
    en: [
      'Express yourself precisely',
      'Nuances of meaning and complex structures.',
    ],
  },
  C1: {
    ru: ['Свободное общение', 'Сложные темы и гибкое использование языка.'],
    en: ['Fluent communication', 'Complex topics and flexible language use.'],
  },
  C2: {
    ru: ['Тонкости языка', 'Точное понимание и выражение сложных идей.'],
    en: [
      'Language mastery',
      'Understanding and expressing complex ideas precisely.',
    ],
  },
  mixed: {
    ru: ['Разные уровни', 'Темы, объединяющие несколько уровней сложности.'],
    en: ['Mixed levels', 'Topics spanning more than one level.'],
  },
};

export function CourseOverviewPage() {
  const owner = useSyncExternalStore(subscribeDataScope, getDataOwnerRevision);
  return <CourseOverview key={owner} />;
}

function CourseOverview() {
  const { status, pack, model, progress, learner, lang, ru } = useCourseData();
  const expanded = useCourseNavigation((s) => s.expanded);
  const root = useRef<HTMLElement>(null);
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  const ready =
    status === 'ready' && !!pack && !!model && progress.status !== 'loading';
  const capture = useBrowsePosition(
    `${pack?.manifest.id ?? ''}:overview:${fromReader}`,
    ready,
    root
  );
  const candidate = model?.candidate;
  const currentLevel =
    pack && candidate
      ? unitLevel(candidate.unit, pack.course.level)
      : undefined;
  const initialLevel = currentLevel ?? model?.groups[0]?.level;
  useEffect(() => {
    if (ready && expanded === null && initialLevel)
      useCourseNavigation.getState().setExpanded([initialLevel]);
  }, [ready, expanded, initialLevel]);
  const open = expanded ?? (initialLevel ? [initialLevel] : []);
  const known = progress.status === 'ready';
  return (
    <section ref={root} className="course-page" onClickCapture={capture}>
      <BackToReader />
      <Link
        to={`/${fromReader ? '?from=reader' : ''}`}
        data-course-focus="back-today"
        className="course-button course-quiet course-back"
      >
        ← {ru ? 'К «Сегодня»' : 'Back to Today'}
      </Link>
      <div className="course-page-title">
        <div>
          <h1 tabIndex={-1}>{ru ? 'Весь курс' : 'Full course'}</h1>
          <p>
            {ru
              ? 'От первых фраз к свободе выражения.'
              : 'From your first phrases to expressing yourself freely.'}
          </p>
        </div>
        {pack && model && (
          <p className="course-total">
            {countLabel(model.groups.length, ru, 'level')} ·{' '}
            {countLabel(pack.units.length, ru, 'topic')} ·{' '}
            {countLabel(model.total, ru, 'day')}
          </p>
        )}
      </div>
      {status === 'error' ? (
        <ContentLoadError />
      ) : !ready ? (
        <p role="status" className="course-muted">
          {ru ? 'Загружаем курс и прогресс…' : 'Loading course and progress…'}
        </p>
      ) : (
        pack &&
        model && (
          <>
            {progress.status === 'error' && (
              <div role="alert" className="course-notice">
                <p>
                  {ru
                    ? 'Прогресс не загрузился. Сохранённые ответы не удалены. Темы по-прежнему доступны.'
                    : 'Progress did not load. Saved answers have not been deleted. Topics remain available.'}
                </p>
                <Button onClick={progress.retry}>
                  {ru ? 'Загрузить прогресс' : 'Retry progress'}
                </Button>
              </div>
            )}
            <CourseResume
              model={model}
              packId={pack.manifest.id}
              placementDone={learner.placementDone}
              lang={lang}
              progressKnown={known}
            />
            <div className="course-overview">
              <div className="course-intro">
                <p>
                  {ru
                    ? 'Раскройте уровень и выберите тему. Дни доступны в любом порядке.'
                    : 'Expand a level and choose a topic. Days are available in any order.'}
                </p>
                {candidate && currentLevel && (
                  <Button
                    variant="ghost"
                    className="course-button course-quiet"
                    onClick={() => {
                      useCourseNavigation
                        .getState()
                        .setExpanded([...new Set([...open, currentLevel])]);
                      requestAnimationFrame(() => {
                        const target = document.getElementById(
                          `course-topic-${candidate.unit.id}`
                        );
                        target?.focus({ preventScroll: true });
                        target?.scrollIntoView({
                          block: 'center',
                          behavior: 'instant',
                        });
                      });
                    }}
                  >
                    {model.explicit
                      ? ru
                        ? 'К рабочей теме'
                        : 'Locate working topic'
                      : ru
                        ? 'К предложенной теме'
                        : 'Locate suggested topic'}
                  </Button>
                )}
              </div>
              {model.groups.length === 0 && (
                <p className="course-notice">
                  {ru
                    ? 'Темы курса пока не добавлены.'
                    : 'Course topics have not been added yet.'}
                </p>
              )}
              {model.groups.map((group) => {
                const isOpen = open.includes(group.level);
                const [title, description] = levelCopy[group.level][lang];
                return (
                  <section
                    key={group.level}
                    className="course-level"
                    data-level={group.level}
                    data-current={currentLevel === group.level}
                    aria-labelledby={`course-toggle-${group.level}`}
                  >
                    <h2>
                      <button
                        type="button"
                        className="course-level-toggle"
                        id={`course-toggle-${group.level}`}
                        data-course-focus={`level:${group.level}`}
                        aria-expanded={isOpen}
                        aria-controls={`course-panel-${group.level}`}
                        onClick={() =>
                          useCourseNavigation
                            .getState()
                            .setExpanded(
                              isOpen
                                ? open.filter((level) => level !== group.level)
                                : [...open, group.level]
                            )
                        }
                      >
                        <span className="course-level-mark">
                          {group.level === 'mixed' ? '…' : group.level}
                        </span>
                        <span className="course-level-name">{title}</span>
                        <span
                          className="course-level-affordance"
                          aria-hidden="true"
                        >
                          <span>
                            {isOpen
                              ? ru
                                ? 'Свернуть'
                                : 'Collapse'
                              : ru
                                ? 'Раскрыть'
                                : 'Expand'}
                          </span>
                          <b>{isOpen ? '⌃' : '⌄'}</b>
                        </span>
                      </button>
                    </h2>
                    <div className="course-level-summary">
                      <p>{description}</p>
                      <div className="course-level-numbers">
                        <span>
                          {countLabel(group.units.length, ru, 'topic')}
                        </span>
                        <span>
                          {known
                            ? ru
                              ? `Завершено дней: ${group.done} из ${group.total}`
                              : `${group.done} of ${group.total} days complete`
                            : ru
                              ? 'Прогресс недоступен'
                              : 'Progress unavailable'}
                        </span>
                        {currentLevel === group.level && (
                          <span className="course-work-label">
                            {model.explicit
                              ? ru
                                ? 'Вы здесь'
                                : 'You are here'
                              : ru
                                ? 'Предлагаем начать здесь'
                                : 'Suggested starting point'}
                          </span>
                        )}
                      </div>
                      <div className="course-level-meter" aria-hidden="true">
                        <span
                          style={{
                            width: `${known && group.total ? (group.done / group.total) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </div>
                    <div id={`course-panel-${group.level}`} hidden={!isOpen}>
                      <ol
                        className="course-topic-track"
                        aria-label={`${ru ? 'Темы' : 'Topics'} ${group.level}`}
                      >
                        {group.units.map((unit, index) => {
                          const done = unit.days.filter(
                            (day) =>
                              model.byId.get(day.id)?.progress.state === 'done'
                          ).length;
                          const partial = unit.days.some(
                            (day) =>
                              model.byId.get(day.id)?.progress.state ===
                              'in-progress'
                          );
                          const workTopic = candidate?.unit.id === unit.id;
                          const complete =
                            known &&
                            unit.days.length > 0 &&
                            done === unit.days.length;
                          const content = (
                            <>
                              <span
                                className="course-topic-station"
                                aria-hidden="true"
                              >
                                {complete
                                  ? '✓'
                                  : String(index + 1).padStart(2, '0')}
                              </span>
                              <span className="course-topic-copy">
                                <span className="course-topic-meta">
                                  {ru ? 'Тема' : 'Topic'} {index + 1}
                                  {workTopic && (
                                    <span className="course-work-label">
                                      {model.explicit
                                        ? ru
                                          ? 'Ваш рабочий день'
                                          : 'Your working day'
                                        : ru
                                          ? 'Предложенный день'
                                          : 'Suggested day'}
                                    </span>
                                  )}
                                </span>
                                <strong>{tr(unit.title, lang)}</strong>
                                <span className="course-topic-count">
                                  {!unit.days.length ? (
                                    ru ? (
                                      'Дни появятся позже'
                                    ) : (
                                      'Days coming later'
                                    )
                                  ) : !known ? (
                                    ru ? (
                                      'Прогресс недоступен'
                                    ) : (
                                      'Progress unavailable'
                                    )
                                  ) : (
                                    <>
                                      {complete
                                        ? ru
                                          ? 'Завершена'
                                          : 'Completed'
                                        : partial || done
                                          ? ru
                                            ? 'В процессе'
                                            : 'In progress'
                                          : ru
                                            ? 'Доступна'
                                            : 'Available'}{' '}
                                      ·{' '}
                                      {ru
                                        ? `Завершено дней: ${done} из ${unit.days.length}`
                                        : `${done} of ${unit.days.length} days complete`}
                                    </>
                                  )}
                                </span>
                              </span>
                              {unit.days.length > 0 && (
                                <span
                                  aria-hidden="true"
                                  className="course-chevron"
                                >
                                  ›
                                </span>
                              )}
                            </>
                          );
                          return (
                            <li
                              key={unit.id}
                              className={workTopic ? 'course-work-topic' : ''}
                            >
                              {unit.days.length ? (
                                <Link
                                  id={`course-topic-${unit.id}`}
                                  data-course-focus={`topic:${unit.id}`}
                                  className="course-topic"
                                  to={`/?unit=${encodeURIComponent(unit.id)}${fromReader ? '&from=reader' : ''}`}
                                  onClick={() =>
                                    useCourseNavigation
                                      .getState()
                                      .viewUnit(unit.id)
                                  }
                                >
                                  {content}
                                </Link>
                              ) : (
                                <div className="course-topic">{content}</div>
                              )}
                            </li>
                          );
                        })}
                      </ol>
                    </div>
                  </section>
                );
              })}
              <footer className="course-page-foot">
                {ru
                  ? 'Уровни описывают содержание курса. Счётчики показывают завершённые дни, а не подтверждённое владение языком.'
                  : 'Levels describe course content. Counts show completed days, not a certified level of English.'}
              </footer>
            </div>
          </>
        )
      )}
    </section>
  );
}
