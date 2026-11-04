import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import type { CheckpointResult } from '@/db/db';
import { useContentStore } from '@/content/store';
import { ContentLoadError } from '@/content/ContentLoadError';
import { tr, useUiLang } from '@/features/i18n/uiLang';
import { useLearner } from '@/features/learner/store';
import { useCourseNavigation } from '@/features/course/navigation';
import { courseModel } from '@/features/course/model';
import { Dialog } from '@/shared/ui/Dialog';
import { ReadingStats } from '@/features/stats/ReadingStats';
import { activeDays, currentStreak, skillMap, type TagStat } from './metrics';
import { checkpointHistory, loadAttempts, vocabSize } from './queries';
import { validTimestamp } from './validation';
import {
  checkpointDate,
  checkpointScore,
  displayDate,
  percentage,
  skillKind,
  skillPresentation,
} from './presentation';
import { ProgressStatus } from './ProgressStatus';
import { useProgressResource } from './useProgressResource';
import { rememberProgress, useProgressView } from './view';
import './progress.css';

const readAttempts = () => loadAttempts({ strict: true });
const readVocabulary = () => vocabSize({ strict: true });
const readCheckpoints = async () => {
  const results = await checkpointHistory({ strict: true });
  if (
    results.some(
      (result) =>
        !result ||
        typeof result.unitId !== 'string' ||
        !result.unitId ||
        !validTimestamp(result.timestamp) ||
        !Number.isInteger(result.total) ||
        result.total < 0 ||
        !Number.isInteger(result.score) ||
        result.score < 0 ||
        result.score > result.total
    )
  )
    throw new Error('Invalid checkpoint history');
  return results;
};

function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, 60000);
    window.addEventListener('focus', tick);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', tick);
    };
  }, []);
  return now;
}

function useOnline() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return online;
}

export function ProgressDashboard() {
  const lang = useUiLang((s) => s.lang),
    ru = lang === 'ru';
  const { status, pack, load } = useContentStore();
  const work = useCourseNavigation((s) => s.work);
  const recommended = useLearner((s) => s.recommendedUnitId);
  const attempts = useProgressResource(readAttempts);
  const vocabulary = useProgressResource(readVocabulary);
  const checkpoints = useProgressResource(readCheckpoints);
  const view = useProgressView();
  const now = useClock(),
    online = useOnline();
  const location = useLocation(),
    navigationType = useNavigationType();
  const restored = useRef(false);
  const root = useRef<HTMLElement>(null);
  const [detail, setDetail] = useState<
    | { kind: 'skill'; stat: TagStat }
    | { kind: 'checkpoint'; result: CheckpointResult }
    | null
  >(null);
  useEffect(() => {
    void load();
  }, [load]);
  const validAttempts = (attempts.data ?? []).filter(
    (a) => a && validTimestamp(a.timestamp) && a.timestamp <= now
  );
  const days = activeDays(validAttempts);
  const map = skillMap(validAttempts);
  const filtered = map.filter(
    (s) => view.filter === 'all' || skillKind(s.tag) === view.filter
  );
  const shown = view.expanded ? filtered : filtered.slice(0, 3);
  const model =
    pack && attempts.status === 'ready'
      ? courseModel(pack, validAttempts, work, recommended)
      : null;
  const candidate = model?.candidate;
  const resumeHref = candidate
    ? `/course/${encodeURIComponent(candidate.unit.id)}/day/${encodeURIComponent(candidate.day.id)}`
    : '/syllabus';
  const resume = (
    <Link to={resumeHref} className="pr-resume">
      <span>
        <strong>
          {candidate
            ? model?.explicit || candidate.progress.state === 'in-progress'
              ? ru
                ? 'Продолжить день'
                : 'Continue day'
              : ru
                ? 'Вернуться к занятиям'
                : 'Back to learning'
            : ru
              ? 'Открыть учебный путь'
              : 'Open learning path'}
        </strong>
        <small>
          {candidate
            ? tr(candidate.day.title, lang)
            : model?.allDone
              ? ru
                ? 'Можно повторить любую тему'
                : 'Revisit any topic'
              : ru
                ? 'Начните с подходящего занятия'
                : 'Start with a suitable lesson'}
        </small>
      </span>
      <span aria-hidden="true">→</span>
    </Link>
  );
  const testable =
    pack?.units.filter((u) =>
      u.days.some((d) =>
        d.sections.some(
          (s) =>
            (s.type === 'practice' || s.type === 'listening') &&
            s.exercises.length
        )
      )
    ) ?? [];
  const levels = [
    ...new Set(
      pack?.units
        .flatMap((u) => u.days)
        .flatMap((d) => (d.level ? [d.level] : [])) ?? []
    ),
  ].filter((level) => {
    const days =
      pack?.units.flatMap((u) => u.days).filter((d) => d.level === level) ?? [];
    return (
      days.length >= 5 &&
      days.some((d) =>
        d.sections.some(
          (s) =>
            (s.type === 'practice' || s.type === 'listening') &&
            s.exercises.length
        )
      )
    );
  });
  useEffect(() => {
    if (
      restored.current ||
      (navigationType !== 'POP' && !location.state?.progressReturn)
    )
      return;
    if (
      root.current?.contains(document.activeElement) &&
      document.activeElement?.matches('input,select,button')
    ) {
      restored.current = true;
      return;
    }
    const anchor = useProgressView.getState().anchor;
    if (!anchor) return;
    const element = document.getElementById(anchor.id);
    if (!element) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      element.focus({ preventScroll: true });
      window.scrollBy({
        top:
          element.getBoundingClientRect().top -
          Math.max(12, Math.min(anchor.top, innerHeight - 80)),
        behavior: 'instant',
      });
      element.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [attempts.status, checkpoints.status, navigationType, location.state]);
  const openSkill = (stat: TagStat) => {
    rememberProgress(`pr-skill-${stat.tag}`);
    setDetail({ kind: 'skill', stat });
  };
  const openCheckpoint = (result: CheckpointResult, index: number) => {
    rememberProgress(`pr-check-${result.id ?? index}`);
    setDetail({ kind: 'checkpoint', result });
  };
  const checkpointTitle = (unitId: string) => {
    if (unitId.startsWith('exit-'))
      return `${unitId.slice(5).toUpperCase()} · ${ru ? 'итоговый тест' : 'exit test'}`;
    const unit = pack?.units.find((u) => u.id === unitId);
    return unit ? tr(unit.title, lang) : unitId;
  };
  const canRepeat = (unitId: string) =>
    unitId.startsWith('exit-')
      ? levels.some((l) => `exit-${l.toLowerCase()}` === unitId)
      : testable.some((u) => u.id === unitId);
  const skill =
    detail?.kind === 'skill' ? skillPresentation(detail.stat.tag, pack) : null;
  const calendar = Array.from({ length: 14 }, (_, index) => {
    const d = new Date(now);
    d.setUTCDate(d.getUTCDate() - 13 + index);
    return d.toISOString().slice(0, 10);
  });
  const number = (n: number) => n.toLocaleString(ru ? 'ru-RU' : 'en-US');
  return (
    <section
      ref={root}
      className="pr"
      aria-label={ru ? 'Прогресс' : 'Progress'}
    >
      <header className="pr-header">
        <div>
          <h1>{ru ? 'Ваш прогресс' : 'Your progress'}</h1>
          <p>
            {ru
              ? 'Занятия, чтение и результаты — в одном месте.'
              : 'Learning, reading and results in one place.'}
          </p>
        </div>
        {resume}
      </header>
      {!online && (
        <aside className="pr-offline" role="status">
          {ru
            ? 'Вы без интернета. Показаны доступные данные устройства; состояние синхронизации не проверяется.'
            : 'You are offline. Available data from this device is shown; sync status is not checked.'}
        </aside>
      )}
      <div className="pr-overview">
        <div className="pr-stat">
          <p className="pr-stat-value">
            {attempts.status === 'ready'
              ? number(currentStreak(validAttempts, new Date(now)))
              : '—'}
            <small>{ru ? 'дн.' : 'days'}</small>
          </p>
          <h2>{ru ? 'Текущая серия' : 'Current streak'}</h2>
          <p>
            {ru
              ? 'Дни подряд с упражнениями'
              : 'Consecutive days with exercises'}
          </p>
        </div>
        <div className="pr-stat">
          <p className="pr-stat-value">
            {attempts.status === 'ready' ? number(days.size) : '—'}
          </p>
          <h2>{ru ? 'Дней с практикой' : 'Practice days'}</h2>
          <p>{ru ? 'За всё время' : 'All time'}</p>
        </div>
        <div className="pr-stat">
          <p className="pr-stat-value">
            {vocabulary.status === 'ready' && vocabulary.data !== null
              ? number(vocabulary.data)
              : '—'}
          </p>
          <h2>{ru ? 'В словаре' : 'In vocabulary'}</h2>
          <p>{ru ? 'Изучаю и знаю · сейчас' : 'Learning and known · now'}</p>
        </div>
      </div>
      {vocabulary.status !== 'ready' && (
        <ProgressStatus
          resource={vocabulary}
          label={ru ? 'словарь' : 'vocabulary'}
          ru={ru}
        />
      )}
      {attempts.status !== 'ready' ? (
        <ProgressStatus
          resource={attempts}
          label={ru ? 'результаты упражнений' : 'exercise results'}
          ru={ru}
        />
      ) : (
        <div className="pr-practice-activity">
          <div>
            <h2>{ru ? 'Ритм занятий' : 'Learning rhythm'}</h2>
            <p>
              {ru
                ? 'Последние 14 дней · упражнения · UTC'
                : 'Last 14 days · exercises · UTC'}
            </p>
          </div>
          <div
            className="pr-calendar"
            role="list"
            aria-label={ru ? 'Активность упражнений' : 'Exercise activity'}
          >
            {calendar.map((day) => (
              <div
                role="listitem"
                key={day}
                className={`pr-calendar-day ${days.has(day) ? 'active' : ''}`}
              >
                <span className="pr-calendar-mark" aria-hidden="true">
                  {days.has(day) ? '✓' : '–'}
                </span>
                <span aria-hidden="true">{day.slice(-2)}</span>
                <span className="sr-only">
                  {displayDate(day, ru, true)}:{' '}
                  {days.has(day)
                    ? ru
                      ? 'была практика'
                      : 'practice completed'
                    : ru
                      ? 'без практики'
                      : 'no practice'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      <details className="pr-method">
        <summary>
          {ru
            ? 'Как считаются серия и словарь?'
            : 'How are streak and vocabulary counted?'}
        </summary>
        <p>
          {ru
            ? 'День с практикой — день, когда сохранён хотя бы один ответ на упражнение. Серия заканчивается сегодня или вчера, дни считаются по UTC. Чтение ниже — по местным датам. Время чтения не продлевает серию упражнений.'
            : 'A practice day has at least one saved exercise answer. The streak ends today or yesterday, using UTC days. Reading below uses local dates and does not extend the exercise streak.'}
        </p>
        <p>
          {ru
            ? 'Словарь — текущее число записей «изучаю» и «знаю», а не число освоенных слов. Эти показатели не зависят от периода чтения.'
            : 'Vocabulary counts current learning and known entries, not mastered words. These figures do not depend on the reading period.'}
        </p>
      </details>
      <ReadingStats now={now} />
      <div className="pr-bottom-grid">
        <section className="pr-panel" aria-labelledby="pr-skills-title">
          <div className="pr-section-head">
            <div>
              <h2 id="pr-skills-title">
                {ru ? 'Что стоит разобрать' : 'What to work on'}
              </h2>
              <p>
                {ru
                  ? 'Точность первых ответов · за всё время'
                  : 'First-answer accuracy · all time'}
              </p>
            </div>
            <label className="pr-filter">
              <span className="sr-only">
                {ru ? 'Тип навыков' : 'Skill type'}
              </span>
              <select
                value={view.filter}
                onChange={(e) =>
                  view.update({ filter: e.target.value, expanded: false })
                }
              >
                {[
                  ['all', 'Все навыки', 'All skills'],
                  ['grammar', 'Грамматика', 'Grammar'],
                  ['vocab', 'Слова', 'Vocabulary'],
                  ['listening', 'Аудирование', 'Listening'],
                  ['other', 'Другие', 'Other'],
                ].map(([id, r, e]) => (
                  <option key={id} value={id}>
                    {ru ? r : e}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {attempts.status !== 'ready' ? (
            <p className="pr-inline-unknown">
              {ru
                ? 'Результаты упражнений пока неизвестны.'
                : 'Exercise results are currently unknown.'}
            </p>
          ) : !filtered.length ? (
            <div className="pr-local-empty">
              <h3>
                {map.length
                  ? ru
                    ? 'Нет результатов этого типа'
                    : 'No results of this type'
                  : ru
                    ? 'Результаты появятся после практики'
                    : 'Results appear after practice'}
              </h3>
              <p>
                {ru
                  ? 'Чтение и добавление слов учитываются отдельно. Первые ответы на упражнения помогут увидеть, что стоит разобрать.'
                  : 'Reading and saved words are counted separately. First exercise answers show what to work on.'}
              </p>
              {map.length ? (
                <button
                  type="button"
                  className="pr-button"
                  onClick={() => view.update({ filter: 'all' })}
                >
                  {ru ? 'Все навыки' : 'All skills'}
                </button>
              ) : (
                resume
              )}
            </div>
          ) : (
            <>
              <div className="pr-skill-list">
                {shown.map((stat) => (
                  <div className="pr-skill-row" key={stat.tag}>
                    <div>
                      <div className="pr-skill-name">
                        <strong>
                          {tr(skillPresentation(stat.tag, pack).title, lang)}
                        </strong>
                        <span>{percentage(stat.correct, stat.total)}</span>
                      </div>
                      <div className="pr-skill-track" aria-hidden="true">
                        <span style={{ width: `${stat.accuracy * 100}%` }} />
                      </div>
                      <p>
                        {ru
                          ? `${stat.correct} из ${stat.total} первых ответов верны`
                          : `${stat.correct} of ${stat.total} first answers correct`}
                        {stat.total < 5 &&
                          (ru ? ' · мало данных' : ' · small sample')}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="pr-button pr-skill-button"
                      id={`pr-skill-${stat.tag}`}
                      onClick={() => openSkill(stat)}
                      aria-label={`${ru ? 'Разобрать' : 'Review'}: ${tr(skillPresentation(stat.tag, pack).title, lang)}`}
                    >
                      {ru ? 'Разобрать' : 'Review'}
                    </button>
                  </div>
                ))}
              </div>
              {filtered.length > 3 && (
                <button
                  type="button"
                  className="pr-button"
                  onClick={() => view.update({ expanded: !view.expanded })}
                >
                  {view.expanded
                    ? ru
                      ? 'Свернуть список'
                      : 'Show less'
                    : ru
                      ? `Показать все · ${filtered.length}`
                      : `Show all · ${filtered.length}`}
                </button>
              )}
            </>
          )}
          <details className="pr-method">
            <summary>
              {ru
                ? 'Почему повторный ответ не меняет процент?'
                : 'Why does a retry not change the percentage?'}
            </summary>
            <p>
              {ru
                ? 'Для каждого уникального задания учитывается попытка с наименьшим номером. Исправление ошибки полезно, но не заменяет первый ответ в этой карте. Это наблюдение по заданиям, не оценка общего уровня языка.'
                : 'Each unique exercise uses the attempt with the lowest attempt number. Correcting an error is useful but does not replace the first answer here. This is exercise data, not an assessment of your overall language level.'}
            </p>
          </details>
        </section>
        <section className="pr-panel" aria-labelledby="pr-checkpoints-title">
          <div className="pr-section-head">
            <div>
              <h2 id="pr-checkpoints-title">
                {ru ? 'Контрольные' : 'Checkpoints'}
              </h2>
              <p>
                {ru
                  ? 'Последние 10 результатов · за всё время'
                  : 'Last 10 results · all time'}
              </p>
            </div>
          </div>
          {checkpoints.status !== 'ready' ? (
            <ProgressStatus
              resource={checkpoints}
              label={ru ? 'контрольные' : 'checkpoints'}
              ru={ru}
            />
          ) : checkpoints.data?.length ? (
            <div className="pr-checkpoints">
              {checkpoints.data.map((result, index) => (
                <button
                  type="button"
                  className="pr-checkpoint"
                  id={`pr-check-${result.id ?? index}`}
                  key={result.id ?? index}
                  onClick={() => openCheckpoint(result, index)}
                >
                  <span>
                    <strong>{checkpointTitle(result.unitId)}</strong>
                    <small>{checkpointDate(result.timestamp, ru)}</small>
                  </span>
                  <span className="pr-check-score">
                    {checkpointScore(result)}
                    <small>
                      {result.score}/{result.total}
                    </small>
                  </span>
                  <span aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="pr-local-empty">
              <h3>
                {ru ? 'Первой контрольной ещё не было' : 'No checkpoint yet'}
              </h3>
              <p>
                {ru
                  ? 'Проверка поможет увидеть результат по блоку. Она доступна отдельно от учебного дня.'
                  : 'A checkpoint shows results for a unit. You can take it separately from a lesson.'}
              </p>
            </div>
          )}
          {status === 'error' && <ContentLoadError />}
          {!!testable.length && (
            <div className="pr-actions">
              <Link
                to={`/checkpoint/${encodeURIComponent(testable[0]!.id)}?from=progress`}
                className="pr-button"
              >
                {ru ? 'Открыть контрольную' : 'Open checkpoint'}:{' '}
                {tr(testable[0]!.title, lang)}
              </Link>
            </div>
          )}
          {!!levels.length && (
            <details className="pr-exit">
              <summary>
                {ru ? 'Итоговые тесты по уровням' : 'Level exit tests'}
              </summary>
              <div className="pr-actions">
                {levels.map((level) => (
                  <Link
                    className="pr-button"
                    key={level}
                    to={`/checkpoint/exit-${level.toLowerCase()}?from=progress`}
                  >
                    {level}
                  </Link>
                ))}
              </div>
              <p>
                {ru
                  ? 'Открытие теста не подтверждает владение уровнем.'
                  : 'Opening a test does not confirm proficiency at that level.'}
              </p>
            </details>
          )}
        </section>
      </div>
      <p className="pr-bottom-note">
        {ru
          ? 'Смотрите на результаты в контексте: регулярность и объём практики помогают учиться, но сами по себе не определяют уровень языка.'
          : 'Keep results in context: regular practice helps you learn but does not determine your language level on its own.'}
      </p>
      {detail && (
        <Dialog
          title={
            detail.kind === 'skill'
              ? tr(skill!.title, lang)
              : ru
                ? 'Результат контрольной'
                : 'Checkpoint result'
          }
          onClose={() => setDetail(null)}
        >
          {detail.kind === 'skill' ? (
            <div className="pr-dialog-copy">
              <p className="pr-dialog-lead">
                {ru
                  ? `${detail.stat.correct} из ${detail.stat.total} первых ответов верны`
                  : `${detail.stat.correct} of ${detail.stat.total} first answers correct`}{' '}
                · {percentage(detail.stat.correct, detail.stat.total)}
              </p>
              <p>
                {detail.stat.total < 5
                  ? ru
                    ? 'Данных пока мало: высокий процент на одном или нескольких заданиях не подтверждает освоение темы.'
                    : 'The sample is small. A high percentage on a few exercises does not confirm mastery.'
                  : ru
                    ? 'Показатель учитывает первые попытки за всё время. Повторные правильные ответы не заменяют их.'
                    : 'This uses all-time first attempts. Correct retries do not replace them.'}
              </p>
              <p>
                {ru
                  ? 'Можно разобрать правило или вернуться к занятию. Отдельная тренировка именно этих ошибок здесь не запускается.'
                  : 'Review a rule or return to learning. This does not start a dedicated session for these errors.'}
              </p>
              {!skill?.rule && (
                <p>
                  {ru
                    ? 'Для этой темы отдельное правило пока не связано.'
                    : 'No reference rule is linked to this topic yet.'}
                </p>
              )}
            </div>
          ) : (
            <div className="pr-dialog-copy">
              <p className="pr-dialog-lead">
                {checkpointTitle(detail.result.unitId)}
              </p>
              <p>{checkpointDate(detail.result.timestamp, ru)}</p>
              <p className="pr-result-score">
                {checkpointScore(detail.result)}
                <span>
                  {detail.result.score}/{detail.result.total}
                </span>
              </p>
              <p>
                {ru
                  ? 'Это сохранённый результат отдельной попытки. Ответы на каждый вопрос в этой сводке не сохранены. Повторная контрольная будет новым прохождением.'
                  : 'This is one saved attempt. Individual answers are not stored in this summary. Retaking creates a new attempt.'}
              </p>
              {!canRepeat(detail.result.unitId) && (
                <p>
                  {ru
                    ? 'Эта контрольная недоступна в текущем курсе. Сохранённый результат остаётся в истории.'
                    : 'This checkpoint is unavailable in the current course. Its result remains in history.'}
                </p>
              )}
            </div>
          )}
          <div className="pr-actions">
            <>
              {detail.kind === 'skill' ? (
                <>
                  {skill?.rule && (
                    <Link
                      className="pr-button pr-primary"
                      to={`/grammar/${encodeURIComponent(skill.rule.id)}?from=progress`}
                    >
                      {ru ? 'Открыть правило' : 'Open rule'}
                    </Link>
                  )}
                  <Link to={resumeHref} className="pr-button">
                    {ru ? 'К занятиям' : 'Back to learning'}
                  </Link>
                </>
              ) : (
                canRepeat(detail.result.unitId) && (
                  <Link
                    className="pr-button pr-primary"
                    to={`/checkpoint/${encodeURIComponent(detail.result.unitId)}?from=progress`}
                  >
                    {ru ? 'Пройти ещё раз' : 'Retake checkpoint'}
                  </Link>
                )
              )}
              <button
                type="button"
                className="pr-button"
                onClick={() => setDetail(null)}
              >
                {ru ? 'Закрыть' : 'Close'}
              </button>
            </>
          </div>
        </Dialog>
      )}
    </section>
  );
}
