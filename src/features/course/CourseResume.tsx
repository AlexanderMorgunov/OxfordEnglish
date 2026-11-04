import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, PixelImage } from '@/shared/ui';
import { tr } from '@/features/i18n/uiLang';
import type { UiLang } from '@/features/i18n/uiLang';
import type { CourseModel } from './model';
import { countLabel } from './model';
import { useCourseNavigation } from './navigation';
import { CourseDialog } from './CourseDialog';

export function CourseResume({
  model,
  packId,
  placementDone,
  lang,
  progressKnown,
  viewedUnitId,
}: {
  model: CourseModel;
  packId: string;
  placementDone: boolean;
  lang: UiLang;
  progressKnown: boolean;
  viewedUnitId?: string;
}) {
  const ru = lang === 'ru';
  const { candidate, partials, explicit } = model;
  const [choosing, setChoosing] = useState(false);
  const navigate = useNavigate();
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  const unitPath = (id: string) =>
    `/?unit=${encodeURIComponent(id)}${fromReader ? '&from=reader' : ''}`;
  if (progressKnown && model.allDone)
    return (
      <section className="course-resume course-complete" data-tour="start">
        <PixelImage
          src="/assets/pixel/ui/complete.png"
          alt=""
          className="h-10 w-10 shrink-0"
        />
        <div className="course-resume-copy">
          <h2>
            {ru ? 'Все дни курса завершены' : 'Every course day is complete'}
          </h2>
          <p>
            {ru
              ? `${model.done} из ${model.total} дней: упражнения практики и аудирования решены верно. Можно повторить любую тему или перейти к чтению.`
              : `${model.done} of ${model.total} days: all practice and listening exercises solved correctly. Revisit any topic or read a book.`}
          </p>
        </div>
        <Link to="/library" className="course-button course-teal">
          {ru ? 'Открыть библиотеку' : 'Open library'}
        </Link>
      </section>
    );
  if (!candidate) return null;
  const choose = progressKnown && !explicit && partials.length > 1;
  return (
    <>
      <section
        className={`course-resume ${!placementDone && !explicit ? 'course-first-visit' : ''}`}
        data-tour="start"
      >
        <PixelImage
          src="/assets/pixel/mascot.png"
          alt=""
          className="course-mascot"
        />
        <div className="course-resume-copy">
          <p className="course-resume-kicker">
            {explicit
              ? ru
                ? 'Ваш рабочий день'
                : 'Your working day'
              : choose
                ? ru
                  ? 'Есть несколько начатых дней'
                  : 'You have several days in progress'
                : !placementDone
                  ? ru
                    ? 'Начните с удобной точки'
                    : 'Start where it suits you'
                  : ru
                    ? 'Предлагаем продолжить'
                    : 'Suggested next day'}
          </p>
          <h2>
            {choose
              ? ru
                ? 'Выберите, что продолжить'
                : 'Choose what to continue'
              : tr(candidate.day.title, lang)}
          </h2>
          <p>
            {progressKnown && candidate.progress.total > 0 && (
              <span className="course-inline-score">
                {ru
                  ? `${candidate.progress.completed} из ${candidate.progress.total} верно. `
                  : `${candidate.progress.completed} of ${candidate.progress.total} correct. `}
              </span>
            )}
            {explicit
              ? ru
                ? 'Можно вернуться к нему после просмотра других тем.'
                : 'Come back here after browsing other topics.'
              : choose
                ? ru
                  ? 'Начатые дни показаны по порядку курса.'
                  : 'Started days are shown in course order.'
                : !placementDone
                  ? ru
                    ? 'Все дни доступны. Тест поможет выбрать старт.'
                    : 'All days are available. A placement test can suggest a starting point.'
                  : ru
                    ? 'Незавершённый день с учётом вашей точки старта.'
                    : 'An unfinished day based on your starting point.'}
          </p>
        </div>
        <div className="course-resume-actions">
          {choose ? (
            <Button
              className="course-button course-primary"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setChoosing(true);
              }}
            >
              {ru ? 'Выбрать день' : 'Choose a day'}
            </Button>
          ) : (
            <Link
              className="course-button course-primary"
              data-course-focus="resume"
              to={`/course/${encodeURIComponent(candidate.unit.id)}/day/${encodeURIComponent(candidate.day.id)}${fromReader ? '?from=reader' : ''}`}
            >
              {explicit || candidate.progress.state === 'in-progress'
                ? ru
                  ? 'Продолжить день'
                  : 'Continue day'
                : ru
                  ? 'Начать день'
                  : 'Start day'}
            </Link>
          )}
          {!choose && partials.length > 1 && (
            <Button
              variant="ghost"
              className="course-button course-quiet"
              onClick={(event) => {
                event.currentTarget.focus({ preventScroll: true });
                setChoosing(true);
              }}
            >
              {ru ? 'Другие начатые' : 'Other started days'}
            </Button>
          )}
          {!placementDone && (
            <Link to="/placement" className="course-button course-quiet">
              {ru ? 'Определить уровень' : 'Find my starting point'}
            </Link>
          )}
          {viewedUnitId && candidate.unit.id !== viewedUnitId && (
            <Link
              to={unitPath(candidate.unit.id)}
              className="course-button course-quiet"
              onClick={() =>
                useCourseNavigation
                  .getState()
                  .selectDay(candidate.unit.id, candidate.day.id)
              }
            >
              {explicit
                ? ru
                  ? 'К рабочей теме'
                  : 'Back to working topic'
                : ru
                  ? 'К предложенной теме'
                  : 'Back to suggested topic'}
            </Link>
          )}
        </div>
      </section>
      {choosing && (
        <CourseDialog
          title={ru ? 'Что продолжим?' : 'What will you continue?'}
          closeLabel={ru ? 'Закрыть выбор дня' : 'Close day choices'}
          onClose={() => setChoosing(false)}
        >
          <p className="course-muted">
            {ru
              ? `${countLabel(partials.length, true, 'day')} в процессе, по порядку курса.`
              : `${countLabel(partials.length, false, 'day')} in progress, in course order.`}
          </p>
          <div className="course-partials">
            {partials.map((entry) => (
              <Button
                key={entry.day.id}
                className="course-button course-partial-choice"
                onClick={() => {
                  useCourseNavigation
                    .getState()
                    .openDay(packId, entry.unit.id, entry.day.id);
                  setChoosing(false);
                  navigate(unitPath(entry.unit.id));
                }}
              >
                <strong>{tr(entry.day.title, lang)}</strong>
                <span>
                  {tr(entry.unit.title, lang)} · {entry.progress.completed}/
                  {entry.progress.total} {ru ? 'верно' : 'correct'}
                </span>
              </Button>
            ))}
          </div>
        </CourseDialog>
      )}
    </>
  );
}
