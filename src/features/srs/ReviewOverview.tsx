import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Button } from '@/shared/ui';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { cefrOf, CEFR_LEVELS, useCefr } from '@/features/vocab/cefr';
import { useLemma } from '@/features/vocab/lemma';
import type { ReviewData } from './review-data';

export function ReviewOverview({
  data,
  resume,
  skipped,
  onStart,
  maintenance,
}: {
  data: ReviewData;
  resume: boolean;
  skipped: boolean;
  onStart: () => void;
  maintenance: ReactNode;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    cefr = useCefr(),
    lemma = useLemma();
  const words = data.due.filter(
    (card) => !card.fromError && card.kind === 'word'
  ).length;
  const phrases = data.due.filter(
    (card) => !card.fromError && card.kind === 'phrase'
  ).length;
  const errors = data.due.filter((card) => card.fromError).length;
  const grammar = data.due.length - words - phrases - errors;
  const first = data.cards.length === 0;
  const mainLabel = resume
    ? ru
      ? 'Продолжить сессию'
      : 'Resume session'
    : skipped
      ? ru
        ? 'Вернуться к пропущенным'
        : 'Return to skipped cards'
      : ru
        ? 'Начать повторение'
        : 'Start review';
  return (
    <div className="rv-intro-grid">
      <div>
        {data.due.length > 0 ? (
          <section
            className="rv-intro-main"
            aria-label={ru ? 'Очередь повторения' : 'Review queue'}
          >
            <div className="rv-start-hero">
              <div className="rv-start-copy">
                <p className="rv-help">
                  {ru ? 'Сейчас к повторению' : 'Ready to review'}
                </p>
                <div className="rv-hero-count">
                  <b>{data.due.length}</b>
                  <span>
                    {ru ? 'карточек в очереди' : 'cards in the queue'}
                  </span>
                </div>
                <p>
                  {ru
                    ? 'Слова и фразы, которым пора уделить внимание. В своём темпе.'
                    : 'Give familiar words and phrases a little attention. At your own pace.'}
                </p>
                <Button onClick={onStart}>{mainLabel}</Button>
              </div>
              <div className="rv-card-stack" aria-hidden="true">
                <div className="rv-sample-card">
                  <span>DayEnglish</span>
                  <strong lang="en">{data.due[0]?.front}</strong>
                  <AppIcon name="review" />
                </div>
              </div>
            </div>
            <div className="rv-queue-strip">
              <span>
                {ru ? 'Слова' : 'Words'} <b>{words}</b>
              </span>
              <span>
                {ru ? 'Фразы' : 'Phrases'} <b>{phrases}</b>
              </span>
              {errors > 0 && (
                <span>
                  {ru ? 'Из ошибок' : 'From mistakes'} <b>{errors}</b>
                </span>
              )}
              {grammar > 0 && (
                <span>
                  {ru ? 'Грамматика' : 'Grammar'} <b>{grammar}</b>
                </span>
              )}
            </div>
            <div className="rv-queue-preview">
              <h2>{ru ? 'В этой очереди' : 'In this queue'}</h2>
              <ul>
                {data.due.slice(0, 4).map((card) => {
                  const rated =
                    !card.fromError && card.kind !== 'grammar-pattern'
                      ? cefrOf(card.front, cefr, lemma)
                      : null;
                  return (
                    <li key={card.id}>
                      <strong lang="en">{card.front}</strong>
                      <span>
                        {card.fromError
                          ? ru
                            ? 'Из ошибки'
                            : 'Mistake'
                          : card.kind === 'word'
                            ? ru
                              ? 'Слово'
                              : 'Word'
                            : card.kind === 'phrase'
                              ? ru
                                ? 'Фраза'
                                : 'Phrase'
                              : ru
                                ? 'Грамматика'
                                : 'Grammar'}
                        {rated && ` · ${CEFR_LEVELS[rated.level]}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {data.due.length > 4 && (
                <p className="rv-help">
                  {ru
                    ? `И ещё ${data.due.length - 4} карточек`
                    : `${data.due.length - 4} more cards`}
                </p>
              )}
            </div>
          </section>
        ) : (
          <section className="rv-empty">
            <div className="rv-empty-mark">
              <AppIcon name="review" />
            </div>
            <h2>
              {first
                ? ru
                  ? 'Здесь будут ваши слова'
                  : 'Your words will appear here'
                : ru
                  ? 'Сейчас повторять нечего'
                  : 'Nothing due right now'}
            </h2>
            <p>
              {first
                ? ru
                  ? 'Сохраните слово или фразу из книги либо добавьте их в словарь. Здесь можно будет закрепить их значение.'
                  : 'Save a word or phrase from a book, or add one to your vocabulary. Return here to practise its meaning.'
                : ru
                  ? 'Карточки вернутся, когда подойдёт время по расписанию.'
                  : 'Cards return when their next review is due.'}
            </p>
            {data.nextDue && (
              <p>
                {ru ? 'Ближайшее повторение: ' : 'Next review: '}
                {data.nextDue.toLocaleString(ru ? 'ru-RU' : 'en-GB', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
            )}
            <Link className="rv-link-button" to="/vocabulary">
              {ru ? 'Открыть мой словарь' : 'Open my vocabulary'}
            </Link>
          </section>
        )}
        {maintenance}
        <p className="rv-help rv-session-note">
          {ru
            ? 'Пауза сохраняется, пока приложение открыто. После перезапуска начнётся новая сессия; записанные оценки сохранятся.'
            : 'Pause lasts while the app stays open. Restarting begins a new session; saved ratings remain.'}
        </p>
      </div>
      <aside>
        <div className="rv-aside-block">
          <h2>{ru ? 'Как это работает' : 'How it works'}</h2>
          <ol className="rv-how-list">
            {[
              [
                ru ? 'Вспомните значение' : 'Recall the meaning',
                ru
                  ? 'Слово останется в знакомом контексте.'
                  : 'Keep the familiar context in view.',
              ],
              [
                ru ? 'Сверьтесь с ответом' : 'Check the answer',
                ru
                  ? 'Откройте перевод, когда будете готовы.'
                  : 'Reveal the translation when you are ready.',
              ],
              [
                ru ? 'Оцените, как вспомнили' : 'Rate your recall',
                ru
                  ? 'Честный ответ помогает выбрать следующее повторение.'
                  : 'An honest rating helps schedule the next review.',
              ],
            ].map(([title, hint], index) => (
              <li key={title}>
                <span className="rv-step">{index + 1}</span>
                <div>
                  <strong>{title}</strong>
                  <p>{hint}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>
        <div className="rv-aside-block">
          <h2>{ru ? 'Слова из вашей жизни' : 'Words from your life'}</h2>
          <p>
            {ru
              ? 'Добавляйте то, что встречается в книгах, и возвращайтесь к этому здесь.'
              : 'Save what you encounter in books and return to it here.'}
          </p>
          <Link className="rv-text-link" to="/vocabulary">
            {ru ? 'Открыть мой словарь' : 'Open my vocabulary'} →
          </Link>
        </div>
      </aside>
    </div>
  );
}
