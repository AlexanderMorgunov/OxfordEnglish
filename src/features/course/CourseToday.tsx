import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ContentLoadError } from '@/content/ContentLoadError';
import { Button, PixelImage } from '@/shared/ui';
import { tr } from '@/features/i18n/uiLang';
import { BackToReader } from '@/features/reader/BackToReader';
import { ExpiryNotice } from '@/features/account/ExpiryNotice';
import { AppearanceThemes } from '@/features/appearance/ThemePicker';
import { CourseResume } from './CourseResume';
import { CourseDialog } from './CourseDialog';
import { DayPreview } from './DayPreview';
import { LearningPath } from './LearningPath';
import { countLabel, unitLevel } from './model';
import { useCourseData } from './useCourseData';
import { useCourseNavigation } from './navigation';
import { useBrowsePosition } from './useBrowsePosition';
import './course.css';

export function CourseToday() {
  const { status, pack, model, progress, learner, lang, ru } = useCourseData();
  const [params] = useSearchParams();
  const root = useRef<HTMLElement>(null);
  const viewedUnitId = useCourseNavigation((s) => s.viewedUnitId);
  const selectedDays = useCourseNavigation((s) => s.selected);
  const [compact, setCompact] = useState(
    () => !window.matchMedia('(min-width: 960px)').matches
  );
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const fromReader = params.get('from') === 'reader';
  const requestedUnit = params.get('unit');
  const unit =
    pack?.units.find((u) => u.id === requestedUnit) ??
    pack?.units.find((u) => u.id === viewedUnitId) ??
    model?.candidate?.unit ??
    pack?.units.find((u) => u.days.length > 0) ??
    pack?.units[0];
  const selected =
    unit?.days.find((day) => day.id === selectedDays[unit.id]) ??
    (model?.candidate?.unit === unit ? model?.candidate?.day : undefined) ??
    unit?.days[0];
  const entry = selected && model?.byId.get(selected.id);
  const days = useMemo(
    () =>
      unit && model ? unit.days.map((day) => model.byId.get(day.id)!) : [],
    [unit, model]
  );
  const ready =
    status === 'ready' && !!pack && !!model && progress.status !== 'loading';
  const capture = useBrowsePosition(
    `${pack?.manifest.id ?? ''}:today:${unit?.id ?? ''}:${fromReader}`,
    ready,
    root
  );
  const progressKnown = progress.status === 'ready';
  useEffect(() => {
    const media = window.matchMedia('(min-width: 960px)');
    const change = () => setCompact(!media.matches);
    media.addEventListener('change', change);
    return () => media.removeEventListener('change', change);
  }, []);
  useEffect(() => {
    if (ready && unit) useCourseNavigation.getState().viewUnit(unit.id);
  }, [ready, unit]);
  const preview = previewId ? model?.byId.get(previewId) : null;
  const unitIndex = unit && pack ? pack.units.indexOf(unit) : -1;
  const nextUnit = pack?.units[unitIndex + 1];
  const completed = days.filter((day) => day.progress.state === 'done').length;
  return (
    <section
      ref={root}
      className="course-page"
      data-onboarding-ready={ready}
      aria-label={ru ? 'Сегодня' : 'Today'}
      onClickCapture={capture}
    >
      <BackToReader />
      <ExpiryNotice ru={ru} />
      <div className="course-page-title">
        <div>
          <h1 tabIndex={-1}>{ru ? 'Сегодня' : 'Today'}</h1>
          <p>{ru ? 'Английский, день за днём.' : 'English, day by day.'}</p>
        </div>
        <Link
          to={`/syllabus${fromReader ? '?from=reader' : ''}`}
          className="course-button"
          data-course-focus="all-course"
        >
          <PixelImage
            src="/assets/pixel/sections/grammar.png"
            alt=""
            className="h-5 w-5 shrink-0"
          />
          {ru ? 'Весь курс' : 'Full course'}
          <span className="course-badge">A1–B2</span>
        </Link>
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
                    ? 'Не удалось прочитать прогресс. Сохранённые ответы не удалены. Можно открыть любой день или повторить загрузку.'
                    : 'Could not read progress. Saved answers have not been deleted. Open any day or retry.'}
                </p>
                <Button onClick={progress.retry}>
                  {ru ? 'Загрузить прогресс' : 'Retry progress'}
                </Button>
              </div>
            )}
            {requestedUnit &&
              !pack.units.some((u) => u.id === requestedUnit) && (
                <p role="status" className="course-notice">
                  {ru
                    ? 'Тема по этой ссылке недоступна. Показана доступная тема курса.'
                    : 'The linked topic is unavailable. Showing an available course topic.'}
                </p>
              )}
            <CourseResume
              model={model}
              packId={pack.manifest.id}
              placementDone={learner.placementDone}
              lang={lang}
              progressKnown={progressKnown}
              viewedUnitId={unit?.id}
            />
            {!unit ? (
              <p className="course-notice">
                {ru
                  ? 'В этом курсе пока нет тем.'
                  : 'This course has no topics yet.'}
              </p>
            ) : (
              <section aria-labelledby="course-unit-title">
                <div className="course-unit-head">
                  <div className="min-w-0">
                    <div className="course-unit-topline">
                      <span className="course-level-tag">
                        {unitLevel(unit, pack.course.level)}
                      </span>
                      <span>
                        {ru
                          ? `Блок ${unitIndex + 1} из ${pack.units.length}`
                          : `Unit ${unitIndex + 1} of ${pack.units.length}`}
                      </span>
                      {learner.placementDone &&
                        unit.id === learner.recommendedUnitId && (
                          <span className="text-teal">
                            {ru
                              ? 'Рекомендован тестом'
                              : 'Suggested by placement'}
                          </span>
                        )}
                    </div>
                    <h2 id="course-unit-title">{tr(unit.title, lang)}</h2>
                  </div>
                  <div className="course-unit-count">
                    <div className="course-segments" aria-hidden="true">
                      {days.map((day) => (
                        <span
                          key={day.day.id}
                          className={progressKnown ? day.progress.state : ''}
                        />
                      ))}
                    </div>
                    <p>
                      {progressKnown
                        ? ru
                          ? `Завершено дней: ${completed} из ${days.length}`
                          : `${completed} of ${days.length} days complete`
                        : ru
                          ? 'Прогресс недоступен'
                          : 'Progress unavailable'}
                    </p>
                  </div>
                </div>
                <div className="course-workspace">
                  <div className="min-w-0">
                    <div
                      className="course-legend"
                      aria-label={ru ? 'Статусы дней' : 'Day statuses'}
                    >
                      <span>
                        <i className="text-teal">✓</i>
                        {ru ? 'Завершён' : 'Completed'}
                      </span>
                      <span>
                        <i className="text-amber">◐</i>
                        {ru ? 'В процессе' : 'In progress'}
                      </span>
                      <span>
                        <i>○</i>
                        {ru ? 'Доступен' : 'Available'}
                      </span>
                    </div>
                    {days.length ? (
                      <LearningPath
                        days={days}
                        selectedId={selected?.id}
                        lang={lang}
                        compact={compact}
                        progressKnown={progressKnown}
                        onSelect={(day) => {
                          useCourseNavigation
                            .getState()
                            .selectDay(unit.id, day.day.id);
                          setAnnouncement(
                            `${ru ? 'Выбран день: ' : 'Selected day: '}${tr(day.day.title, lang)}`
                          );
                          if (compact) setPreviewId(day.day.id);
                        }}
                      />
                    ) : (
                      <p className="course-notice">
                        {ru
                          ? 'Дни этой темы появятся позже. Выберите другую тему из курса.'
                          : 'Days for this topic are coming later. Choose another topic.'}
                      </p>
                    )}
                    <div className="course-path-end">
                      {unit.checkpoint && days.length > 0 && (
                        <Link
                          to={`/checkpoint/${unit.id}`}
                          data-course-focus="checkpoint"
                          className="course-checkpoint"
                        >
                          <PixelImage
                            src="/assets/pixel/ui/placement.png"
                            alt=""
                            className="h-7 w-7 shrink-0"
                          />
                          <span>
                            <strong>
                              {ru ? 'Контрольная по блоку' : 'Unit checkpoint'}
                            </strong>
                            <small>
                              {unit.checkpoint.questionCount
                                ? `${unit.checkpoint.questionCount} ${ru ? 'вопросов · ' : 'questions · '}`
                                : ''}
                              {ru
                                ? 'доступна в любое время'
                                : 'available anytime'}
                            </small>
                          </span>
                          <span aria-hidden="true">→</span>
                        </Link>
                      )}
                      {nextUnit ? (
                        <Link
                          to={`/?unit=${encodeURIComponent(nextUnit.id)}${fromReader ? '&from=reader' : ''}`}
                          className="course-button course-next"
                          data-course-focus="next-unit"
                        >
                          {ru ? 'Следующий блок: ' : 'Next unit: '}
                          {tr(nextUnit.title, lang)}{' '}
                          <span aria-hidden="true">→</span>
                        </Link>
                      ) : (
                        <p className="course-muted">
                          {ru
                            ? 'Это последний блок курса. Любой день можно повторить.'
                            : 'This is the final unit. You can revisit any day.'}
                        </p>
                      )}
                    </div>
                  </div>
                  <aside
                    aria-label={
                      ru
                        ? 'Выбранный день и повторение'
                        : 'Selected day and review'
                    }
                  >
                    {!compact && entry && (
                      <div id="course-day-preview">
                        <DayPreview
                          entry={entry}
                          lang={lang}
                          progressKnown={progressKnown}
                        />
            <AppearanceThemes placement="today" />
                      </div>
                    )}
                    <div className="course-review">
                      <PixelImage
                        src="/assets/pixel/nav/review.png"
                        alt=""
                        className="h-6 w-6 shrink-0"
                      />
                      <div>
                        <h3>
                          {ru
                            ? 'Слова возвращаются вовремя'
                            : 'Words return at the right time'}
                        </h3>
                        <p>
                          {progress.due === null
                            ? ru
                              ? 'Отдельная практика слов по интервальным карточкам.'
                              : 'A separate spaced-repetition practice for your vocabulary.'
                            : progress.due
                              ? `${countLabel(progress.due, ru, 'card')} ${ru ? 'к повторению.' : 'due for review.'}`
                              : ru
                                ? 'На сегодня карточек нет. Можно открыть словарь.'
                                : 'No cards due today. You can explore your vocabulary.'}
                        </p>
                        <Link
                          to="/review"
                          className="course-text-link"
                          data-course-focus="review"
                        >
                          {ru ? 'К повторению' : 'Go to review'}
                        </Link>
                      </div>
                    </div>
                  </aside>
                </div>
              </section>
            )}
            <footer className="course-page-foot">
              <p>
                {ru
                  ? 'День завершён, когда все упражнения практики и аудирования решены верно. Чтение разделов не меняет этот счётчик.'
                  : 'A day is complete when all practice and listening exercises are solved correctly. Reading sections does not change this count.'}
              </p>
              <p>
                {ru ? 'Все дни открыты. ' : 'All days are open. '}
                {progressKnown &&
                  (ru
                    ? `В курсе завершено дней: ${model.done} из ${model.total}. `
                    : `${model.done} of ${model.total} course days complete. `)}
                <Link to="/placement" className="course-text-link">
                  {ru ? 'Как выбран старт' : 'How the starting point is chosen'}
                </Link>
              </p>
            </footer>
          </>
        )
      )}
      <p className="sr-only" role="status">
        {announcement}
      </p>
      {preview && (
        <CourseDialog
          title={ru ? 'Обзор дня' : 'Day overview'}
          closeLabel={ru ? 'Закрыть обзор дня' : 'Close day overview'}
          onClose={() => setPreviewId(null)}
        >
          <DayPreview
            entry={preview}
            lang={lang}
            progressKnown={progressKnown}
            inDialog
            onOpen={() => setPreviewId(null)}
          />
        </CourseDialog>
      )}
    </section>
  );
}
