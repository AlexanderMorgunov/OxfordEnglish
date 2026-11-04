import { useCallback, useId } from 'react';
import { Link } from 'react-router-dom';
import type { CSSProperties } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { PixelImage } from '@/shared/ui';
import { ProgressStatus } from '@/features/progress/ProgressStatus';
import { useProgressResource } from '@/features/progress/useProgressResource';
import { useProgressView } from '@/features/progress/view';
import {
  displayDate,
  duration,
  percentage,
} from '@/features/progress/presentation';
import { validDay } from '@/features/progress/validation';
import { periodRange, summarize, type Period } from './accounting';
import { loadActivity, statsSince } from './activity';

const PERIODS: { id: Period; ru: string; en: string }[] = [
  { id: 'day', ru: 'Сегодня', en: 'Today' },
  { id: 'week', ru: '7 дней', en: '7 days' },
  { id: 'month', ru: '30 дней', en: '30 days' },
  { id: 'year', ru: '12 месяцев', en: '12 months' },
];

export function ReadingStats({ now = Date.now() }: { now?: number }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const view = useProgressView();
  const from = periodRange('year', now).from;
  const load = useCallback(async () => {
    const [data, since] = await Promise.all([
      loadActivity(from, { strict: true }),
      statsSince({ strict: true }),
    ]);
    return { ...data, since };
  }, [from]);
  const resource = useProgressResource(load);
  const s = resource.data
    ? summarize(resource.data.rows, resource.data.reviews, view.period, now)
    : null;
  const range = periodRange(view.period, now);
  const empty =
    s &&
    ![
      s.readSec,
      s.readWords,
      s.wordsSaved,
      s.phrasesSaved,
      s.reviews,
      s.learned,
    ].some(Boolean);
  const first = resource.data?.since;
  const number = (n: number) => n.toLocaleString(ru ? 'ru-RU' : 'en-US');
  const selected = s?.bars.find((b) => b.key === view.bar);
  const max = Math.max(1, ...(s?.bars.map((b) => b.sec) ?? []));
  const pickerId = useId();
  return (
    <section className="pr-reading" aria-labelledby="pr-reading-title">
      <div className="pr-section-head">
        <div>
          <h2 id="pr-reading-title">
            {ru ? 'Чтение и слова' : 'Reading and words'}
          </h2>
          <p>
            {ru
              ? 'Счётчики за период · местные даты'
              : 'Period totals · local dates'}
          </p>
        </div>
        <div
          className="pr-period"
          role="group"
          aria-label={ru ? 'Период чтения' : 'Reading period'}
        >
          {PERIODS.map((p) => (
            <button
              type="button"
              key={p.id}
              aria-pressed={p.id === view.period}
              onClick={() => view.update({ period: p.id, bar: '' })}
            >
              {ru ? p.ru : p.en}
            </button>
          ))}
        </div>
      </div>
      <p className="pr-date-range">
        {displayDate(range.from, ru, true)} — {displayDate(range.to, ru, true)}
      </p>
      {resource.status !== 'ready' ? (
        <ProgressStatus
          resource={resource}
          label={ru ? 'чтение и слова' : 'reading and words'}
          ru={ru}
        />
      ) : empty ? (
        <div className="pr-empty-period">
          <PixelImage
            src="/assets/pixel/nav/library.png"
            alt=""
            className="mx-auto mb-5 h-12 w-12"
          />
          <h3>
            {first
              ? ru
                ? 'В этом периоде пока пусто'
                : 'Nothing in this period yet'
              : ru
                ? 'Ваша история начинается здесь'
                : 'Your story starts here'}
          </h3>
          <p>
            {first && validDay(first)
              ? ru
                ? `Статистика собирается с ${displayDate(first, ru, true)}. Выберите другой период или вернитесь к чтению.`
                : `Stats are collected since ${displayDate(first, ru, true)}. Try another period or read a book.`
              : ru
                ? 'Почитайте книгу или повторите слова — здесь появятся первые результаты.'
                : 'Read a book or review words to see your first results here.'}
          </p>
          <div className="pr-actions">
            {first && view.period !== 'year' && (
              <button
                type="button"
                className="pr-button"
                onClick={() => view.update({ period: 'year', bar: '' })}
              >
                {ru ? 'Посмотреть 12 месяцев' : 'View 12 months'}
              </button>
            )}
            <Link to="/library" className="pr-button">
              {ru ? 'Открыть библиотеку' : 'Open library'}
            </Link>
          </div>
        </div>
      ) : (
        s && (
          <>
            <div className="pr-reading-layout">
              <div className="pr-chart-side">
                <p className="pr-big-number" data-reading-total>
                  {duration(s.readSec, ru)}
                </p>
                <p className="pr-small">
                  {ru ? 'Активное время чтения' : 'Active reading time'}
                </p>
                <div
                  className="pr-chart"
                  role="group"
                  aria-label={
                    ru ? 'Время чтения по датам' : 'Reading time by date'
                  }
                >
                  {s.bars.map((b) => (
                    <button
                      type="button"
                      key={b.key}
                      className="pr-bar"
                      data-bar-key={b.key}
                      data-seconds={b.sec}
                      aria-label={`${displayDate(b.key, ru, true)}: ${duration(b.sec, ru)}`}
                      aria-pressed={view.bar === b.key}
                      onClick={() => view.update({ bar: b.key })}
                      style={
                        {
                          '--bar-height': `${(b.sec / max) * 100}%`,
                        } as CSSProperties
                      }
                    >
                      <span className="pr-bar-line" aria-hidden="true" />
                      <span className="pr-bar-label" aria-hidden="true">
                        {s.bars.length <= 7
                          ? b.key.slice(-2)
                          : view.period === 'year'
                            ? displayDate(b.key, ru)
                            : ''}
                      </span>
                    </button>
                  ))}
                </div>
                <label className="pr-date-picker" htmlFor={pickerId}>
                  {view.period === 'year'
                    ? ru
                      ? 'Посмотреть месяц'
                      : 'View month'
                    : ru
                      ? 'Посмотреть день'
                      : 'View day'}
                  <select
                    id={pickerId}
                    value={selected?.key ?? ''}
                    onChange={(e) => view.update({ bar: e.target.value })}
                  >
                    <option value="" disabled>
                      {ru ? 'Выберите дату' : 'Choose a date'}
                    </option>
                    {s.bars.map((b) => (
                      <option key={b.key} value={b.key}>
                        {displayDate(b.key, ru, true)}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="pr-bar-detail" role="status">
                  {selected
                    ? `${displayDate(selected.key, ru, true)}: ${duration(selected.sec, ru)}`
                    : ru
                      ? 'Нажмите на столбец или выберите дату, чтобы посмотреть значение.'
                      : 'Select a bar or date to see the value.'}
                </p>
                <details className="pr-table-disclosure">
                  <summary>
                    {ru ? 'Все значения в таблице' : 'All values in a table'}
                  </summary>
                  <div className="pr-table-wrap">
                    <table>
                      <caption>
                        {ru ? 'Активное чтение' : 'Active reading'}:{' '}
                        {displayDate(range.from, ru)} —{' '}
                        {displayDate(range.to, ru)}
                      </caption>
                      <thead>
                        <tr>
                          <th scope="col">{ru ? 'Дата' : 'Date'}</th>
                          <th scope="col">{ru ? 'Время' : 'Time'}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {s.bars.map((b) => (
                          <tr key={b.key}>
                            <th scope="row">{displayDate(b.key, ru, true)}</th>
                            <td>{duration(b.sec, ru)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              </div>
              <dl className="pr-reading-numbers">
                {[
                  [ru ? 'Слов прочитано' : 'Words read', s.readWords],
                  [ru ? 'Добавлено слов' : 'Words saved', s.wordsSaved],
                  [ru ? 'Добавлено фраз' : 'Phrases saved', s.phrasesSaved],
                ].map(([label, n]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{number(Number(n))}</dd>
                  </div>
                ))}
                <div>
                  <dt>{ru ? 'Повторений карточек' : 'Card reviews'}</dt>
                  <dd>
                    {number(s.reviews)}
                    <span>
                      {s.reviews
                        ? ru
                          ? `Ответ «помню»: ${percentage(s.recalled, s.reviews)} · ${number(s.recalled)} из ${number(s.reviews)}`
                          : `Recalled: ${percentage(s.recalled, s.reviews)} · ${number(s.recalled)} of ${number(s.reviews)}`
                        : ru
                          ? 'Ещё нет ответов'
                          : 'No answers yet'}
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>{ru ? 'Отмечено «знаю»' : 'Marked known'}</dt>
                  <dd>{number(s.learned)}</dd>
                </div>
              </dl>
            </div>
            {!!s.books.length && (
              <div className="pr-books">
                <h3>{ru ? 'Что вы читали' : 'What you read'}</h3>
                {s.books.map((book) => (
                  <div className="pr-book-row" key={book.key}>
                    <PixelImage
                      src="/assets/pixel/nav/library.png"
                      alt=""
                      className="h-8 w-8 shrink-0"
                    />
                    <div className="pr-book-name">
                      <strong>{book.title}</strong>
                      <span>
                        {ru
                          ? `${number(book.words)} слов прочитано · ${number(book.saved)} добавлений`
                          : `${number(book.words)} words read · ${number(book.saved)} saves`}
                      </span>
                    </div>
                    <span className="pr-book-time">
                      {duration(book.sec, ru)}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <details className="pr-method">
              <summary>
                {ru
                  ? 'Что входит в эти числа?'
                  : 'What do these numbers include?'}
              </summary>
              <p>
                {ru
                  ? 'Чтение учитывается, пока читалка видна и активна: недавнее взаимодействие или озвучка. Количество прочитанных слов — оценка по показанным абзацам; понимание текста не измеряется.'
                  : 'Reading time counts while the reader is visible and active, with recent interaction or read-aloud. Words read are estimated from displayed paragraphs; comprehension is not measured.'}
              </p>
              <p>
                {ru
                  ? 'Добавления для книги включают слова и фразы. Повторения — ответы на карточки: одно слово может встретиться несколько раз. «Помню» означает Good или Easy. «Отмечено знаю» — число таких действий за период, а не проверка долговременной памяти.'
                  : 'Book saves include words and phrases. Reviews count card answers; one word may appear several times. Recalled means Good or Easy. Marked known counts those actions during the period, not a test of long-term memory.'}
              </p>
            </details>
          </>
        )
      )}
    </section>
  );
}
