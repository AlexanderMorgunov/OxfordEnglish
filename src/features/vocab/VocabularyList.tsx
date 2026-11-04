import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Link,
  useLocation,
  useNavigationType,
  useSearchParams,
} from 'react-router-dom';
import { Button } from '@/shared/ui';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useUiLang } from '@/features/i18n/uiLang';
import { withReaderReturn } from '@/features/reader/return-to-reader';
import { matchesFilter, searchLexicon, sortLexicon } from './lexicon';
import type { LexiconEntry, LexiconFilter, LexiconSort } from './lexicon';
import {
  useVocabularyView,
  vocabularyEntryId,
  vocabularyEntryPath,
} from './navigation';
import type { useVocabularyData } from './vocabulary-data';
import { useCefr, cefrOf } from './cefr';
import { useLemma } from './lemma';
import { VocabularyRating } from './VocabularyRating';
import { VocabularyIcon, VocabularySpeak } from './VocabularySpeech';
import type { useVocabularySpeech } from './useVocabularySpeech';

const EMPTY_ENTRIES: LexiconEntry[] = [];
const FILTERS: {
  id: LexiconFilter;
  ru: string;
  en: string;
  helpRu: string;
  helpEn: string;
}[] = [
  { id: 'all', ru: 'Все', en: 'All', helpRu: '', helpEn: '' },
  {
    id: 'learning',
    ru: 'Учу',
    en: 'Learning',
    helpRu: 'Слова и фразы с вашей отметкой «Учу».',
    helpEn: 'Words and phrases you marked Learning.',
  },
  {
    id: 'known',
    ru: 'Знаю',
    en: 'Known',
    helpRu: 'Ваша отметка «Знаю»; она не подтверждает уровень владения языком.',
    helpEn: 'Your own Known status, not a measured language level.',
  },
  {
    id: 'saved',
    ru: 'Без отметки',
    en: 'No status',
    helpRu: 'Карточки слов без отметки. Фразы — в отдельном фильтре.',
    helpEn: 'Word cards without a status. Phrases have their own filter.',
  },
  {
    id: 'phrases',
    ru: 'Фразы',
    en: 'Phrases',
    helpRu: 'Все фразы, включая скрытые. Фильтры могут пересекаться.',
    helpEn: 'All phrases, including hidden ones. Filters can overlap.',
  },
  {
    id: 'ignored',
    ru: 'Скрытые',
    en: 'Hidden',
    helpRu:
      'Скрытые слова и фразы не появляются во «Все» и не попадают в повторения.',
    helpEn: 'Hidden terms stay out of All and the review queue.',
  },
];
const SORTS: { id: LexiconSort; ru: string; en: string }[] = [
  { id: 'recent', ru: 'Недавние', en: 'Recent' },
  { id: 'alpha', ru: 'По алфавиту', en: 'Alphabetical' },
  { id: 'due', ru: 'По сроку повторения', en: 'Review date' },
  { id: 'useful', ru: 'По полезности', en: 'Usefulness' },
];
function dueLabel(count: number, ru: boolean) {
  if (!ru) return `${count} ${count === 1 ? 'card' : 'cards'} due for review`;
  const noun =
    count % 10 === 1 && count % 100 !== 11
      ? 'карточка'
      : count % 10 >= 2 &&
          count % 10 <= 4 &&
          (count % 100 < 12 || count % 100 > 14)
        ? 'карточки'
        : 'карточек';
  return `${count} ${noun} к повторению`;
}

export function VocabularyList({
  resource,
  speech,
  onAdd,
}: {
  resource: ReturnType<typeof useVocabularyData>;
  speech: ReturnType<typeof useVocabularySpeech>;
  onAdd: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    location = useLocation(),
    navigationType = useNavigationType();
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  const { query, filter, sort, limit, anchor, update } = useVocabularyView();
  const cefr = useCefr(),
    lemma = useLemma(),
    entries = resource.data?.entries ?? EMPTY_ENTRIES;
  const search = useRef<HTMLInputElement>(null),
    title = useRef<HTMLHeadingElement>(null);
  const restored = useRef<string | null>(null),
    restoreAfterRetry = useRef(false);
  const view = useMemo(
    () =>
      searchLexicon(
        sortLexicon(
          entries.filter((e) => matchesFilter(e, filter)),
          sort,
          (e) => cefrOf(e.display, cefr, lemma)?.order ?? Infinity
        ),
        query
      ),
    [entries, query, sort, filter, cefr, lemma]
  );
  const [, refreshClock] = useState(0);
  const now = Date.now();
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') refreshClock((n) => n + 1);
    };
    const timer = setInterval(refresh, 60000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);
  const due = resource.data
    ? entries.filter(
        (e) =>
          e.hasCard &&
          e.status !== 'ignored' &&
          e.due !== undefined &&
          e.due <= now
      ).length
    : null;
  const help = FILTERS.find((f) => f.id === filter)!;
  useEffect(() => {
    if (
      resource.status !== 'ready' ||
      (restored.current === location.key && !restoreAfterRetry.current)
    )
      return;
    const frame = requestAnimationFrame(() => {
      restored.current = location.key;
      const row =
        anchor &&
        document.querySelector<HTMLAnchorElement>(
          `[data-vocabulary-id="${vocabularyEntryId(anchor.key)}"]`
        );
      const shouldReturn =
        navigationType === 'POP' ||
        !!(location.state as { vocabularyReturn?: boolean } | null)
          ?.vocabularyReturn;
      if (shouldReturn && row && !restoreAfterRetry.current) {
        window.scrollTo({ top: anchor!.y, behavior: 'instant' });
        row.focus({ preventScroll: true });
        row.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } else if (
        restoreAfterRetry.current &&
        document.activeElement === document.body
      )
        search.current?.focus();
      else if (document.activeElement === document.body)
        title.current?.focus({ preventScroll: true });
      restoreAfterRetry.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [resource.status, location.key, location.state, navigationType, anchor]);
  const clear = () => {
    update({ query: '', filter: 'all', limit: 8 });
    requestAnimationFrame(() => search.current?.focus());
  };
  const link = (path: string) => (fromReader ? withReaderReturn(path) : path);
  return (
    <>
      <div className="vc-heading">
        <div>
          <h1 ref={title} tabIndex={-1}>
            {ru ? 'Мой словарь' : 'My vocabulary'}
          </h1>
          <p>
            {ru
              ? 'Слова и фразы, к которым хочется вернуться.'
              : 'Words and phrases worth coming back to.'}
          </p>
        </div>
        <Button
          className="vc-add-button"
          data-onboarding="vocabulary-add"
          aria-label={ru ? 'Добавить слово' : 'Add a word or phrase'}
          disabled={resource.status !== 'ready'}
          onClick={onAdd}
        >
          <VocabularyIcon name="plus" />
          <span className="vc-add-long">
            {ru ? 'Добавить слово' : 'Add a word or phrase'}
          </span>
          <span className="vc-add-short" aria-hidden="true">
            {ru ? 'Добавить' : 'Add'}
          </span>
        </Button>
      </div>
      <div className="vc-review">
        <div className="vc-review-copy">
          <strong>
            {due === null
              ? ru
                ? 'Количество карточек пока неизвестно'
                : 'Card count unavailable'
              : dueLabel(due, ru)}
          </strong>
          <p>
            {ru
              ? 'Возвращайтесь к словам в своём ритме.'
              : 'Return to your words at your own pace.'}
          </p>
        </div>
        <Link
          className="vc-button"
          to={link('/review')}
          aria-label={ru ? 'Перейти к повторению' : 'Go to review'}
        >
          {ru ? 'Повторить' : 'Review'}
        </Link>
      </div>
      <div className="vc-toolbar">
        <label className="vc-search-label">
          <span>
            {ru ? 'Найти слово или перевод' : 'Find a word or translation'}
          </span>
          <input
            type="search"
            className="vc-input"
            ref={search}
            value={query}
            onChange={(e) => update({ query: e.target.value, limit: 8 })}
            placeholder={ru ? 'Слово или перевод' : 'Word or translation'}
          />
        </label>
        <label className="vc-sort">
          <span>{ru ? 'Порядок слов' : 'Word order'}</span>
          <select
            className="vc-select"
            value={sort}
            onChange={(e) =>
              update({ sort: e.target.value as LexiconSort, limit: 8 })
            }
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {ru ? s.ru : s.en}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div
        className="vc-filter-row"
        role="group"
        aria-label={ru ? 'Фильтр словаря' : 'Vocabulary filter'}
      >
        {FILTERS.map((f) => (
          <button
            key={f.id}
            className="vc-filter"
            aria-pressed={filter === f.id}
            onClick={() => update({ filter: f.id, limit: 8 })}
          >
            {ru ? f.ru : f.en}
            <small>
              {resource.data
                ? entries.filter((e) => matchesFilter(e, f.id)).length
                : '—'}
            </small>
          </button>
        ))}
      </div>
      {filter !== 'all' && (
        <p className="vc-filter-explain">{ru ? help.helpRu : help.helpEn}</p>
      )}
      {resource.status !== 'ready' ? (
        <div className="vc-empty" aria-busy={resource.status === 'loading'}>
          <h2>
            {resource.status === 'loading'
              ? ru
                ? 'Загружаем словарь'
                : 'Loading vocabulary'
              : resource.status === 'cancelled'
                ? ru
                  ? 'Загрузка остановлена'
                  : 'Loading stopped'
                : ru
                  ? 'Не удалось открыть словарь'
                  : 'Could not open vocabulary'}
          </h2>
          <p>
            {ru
              ? 'Поиск и фильтры остаются на месте. Количество слов пока неизвестно.'
              : 'Your search and filters are preserved. Word counts are not available yet.'}
          </p>
          {resource.status === 'loading' ? (
            <Button variant="ghost" onClick={resource.cancel}>
              {ru ? 'Отменить загрузку' : 'Cancel loading'}
            </Button>
          ) : (
            <Button
              onClick={() => {
                restoreAfterRetry.current = true;
                resource.retry();
              }}
            >
              {ru ? 'Повторить загрузку' : 'Retry loading'}
            </Button>
          )}
        </div>
      ) : !entries.length ? (
        <div className="vc-empty">
          <div className="vc-empty-mark">
            <AppIcon name="vocabulary" />
          </div>
          <h2>
            {ru ? 'Ваши первые слова — здесь' : 'Your first words belong here'}
          </h2>
          <p>
            {ru
              ? 'Сохраняйте интересные слова во время чтения или добавьте слово, которое хотите запомнить.'
              : 'Save interesting words while reading, or add one you want to remember.'}
          </p>
          <div className="vc-actions">
            <Button onClick={onAdd}>
              {ru ? 'Добавить первое слово' : 'Add your first word'}
            </Button>
            <Link className="vc-button quiet" to="/library">
              {ru ? 'Выбрать книгу' : 'Choose a book'}
            </Link>
          </div>
        </div>
      ) : !view.length ? (
        <div className="vc-empty">
          <h2>{ru ? 'Совпадений нет' : 'No matches'}</h2>
          <p>
            {query.trim()
              ? ru
                ? `Не нашли «${query.trim()}» в выбранном разделе. Попробуйте другой перевод или измените фильтр.`
                : `No matches for “${query.trim()}” in this section. Try another translation or filter.`
              : ru
                ? 'В этом разделе пока нет слов. Можно выбрать другой фильтр.'
                : 'There are no words in this section yet. Try another filter.'}
          </p>
          <Button onClick={clear}>
            {ru ? 'Сбросить поиск и фильтр' : 'Clear search and filter'}
          </Button>
        </div>
      ) : (
        <>
          <div className="vc-results-meta">
            <p aria-live="polite">
              {ru
                ? `${view.length} слов и фраз · показано ${Math.min(view.length, limit)}`
                : `${view.length} words and phrases · showing ${Math.min(view.length, limit)}`}
            </p>
            {query || filter !== 'all' ? (
              <button className="vc-text-button" onClick={clear}>
                {ru ? 'Сбросить' : 'Reset'}
              </button>
            ) : (
              <span>
                {ru
                  ? 'Слово → перевод → детали'
                  : 'Word → translation → details'}
              </span>
            )}
          </div>
          <ul
            className="vc-list"
            aria-label={ru ? 'Слова и фразы' : 'Words and phrases'}
          >
            {view.slice(0, limit).map((entry) => (
              <li key={entry.key}>
                <div className="vc-row">
                  <div className="vc-row-term">
                    <div className="vc-word-line">
                      <Link
                        to={link(vocabularyEntryPath(entry.key))}
                        className="vc-entry-link"
                        data-vocabulary-id={vocabularyEntryId(entry.key)}
                        aria-label={`${entry.display} — ${entry.translation || (ru ? 'без перевода' : 'no translation')}`}
                        onClick={() =>
                          update({
                            anchor: { key: entry.key, y: window.scrollY },
                          })
                        }
                      >
                        <strong lang="en">{entry.display}</strong>
                      </Link>
                      <VocabularySpeak term={entry.display} speech={speech} />
                    </div>
                    <div className="vc-row-tags">
                      <span
                        className={entry.status === 'known' ? 'vc-known' : ''}
                      >
                        {entry.status === 'known'
                          ? ru
                            ? '✓ Знаю'
                            : '✓ Known'
                          : entry.status === 'learning'
                            ? ru
                              ? 'Учу'
                              : 'Learning'
                            : entry.status === 'ignored'
                              ? ru
                                ? 'Скрыто'
                                : 'Hidden'
                              : ru
                                ? 'Без отметки'
                                : 'No status'}
                      </span>
                      {entry.kind === 'phrase' && (
                        <span>{ru ? 'Фраза' : 'Phrase'}</span>
                      )}
                      <VocabularyRating
                        hit={
                          entry.kind === 'word'
                            ? cefrOf(entry.display, cefr, lemma)
                            : null
                        }
                      />
                    </div>
                  </div>
                  <div className="vc-row-meaning" lang="ru">
                    {entry.translation || (
                      <small className="vc-no-meaning">
                        {ru ? 'Перевод пока не добавлен' : 'No translation yet'}
                      </small>
                    )}
                  </div>
                  <div className="vc-row-tail">
                    {entry.status !== 'ignored' &&
                      entry.due !== undefined &&
                      entry.due <= now && (
                        <span className="vc-due">
                          {ru ? 'К повторению' : 'Due'}
                        </span>
                      )}
                    <VocabularyIcon name="arrow" />
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {view.length > limit && (
            <div className="vc-more">
              <Button
                variant="ghost"
                onClick={() => update({ limit: limit + 8 })}
              >
                {ru
                  ? `Показать ещё · ${view.length - limit}`
                  : `Show more · ${view.length - limit}`}
              </Button>
            </div>
          )}
          <p className="vc-list-foot">
            {ru
              ? 'Точки — полезность по уровню CEFR: A1 — 5/5, A2 — 4/5, B1 — 3/5, B2 — 2/5. Это условный ориентир, не точная частотность и не оценка ваших знаний. «Нет оценки» означает отсутствие данных.'
              : 'Dots estimate CEFR usefulness: A1 — 5/5, A2 — 4/5, B1 — 3/5, B2 — 2/5. This is a guide, not exact frequency or a knowledge score. Unrated means no data.'}
          </p>
        </>
      )}
    </>
  );
}
