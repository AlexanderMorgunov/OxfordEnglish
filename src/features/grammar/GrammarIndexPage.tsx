import { useEffect, useRef } from 'react';
import { Link, useLocation, useNavigationType } from 'react-router-dom';
import { useGrammarStore } from '@/content/grammarStore';
import { tr, useUiLang } from '@/features/i18n/uiLang';
import { Button, PixelImage } from '@/shared/ui';
import { LEVEL_ORDER } from '@/shared/levels';
import { BackToReader } from '@/features/reader/BackToReader';
import { CATEGORIES, categoryOf, grammarHref, matchesGrammar } from './model';
import { useGrammarView } from './navigation';
import { useGrammarSource } from './useGrammarSource';
import { GrammarState } from './GrammarState';
import './grammar.css';

export function GrammarIndexPage() {
  const { status, articles, load } = useGrammarStore();
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const view = useGrammarView();
  const { source, dayHref } = useGrammarSource();
  const root = useRef<HTMLElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const restored = useRef(false);
  const location = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    void load();
  }, [load]);
  const sorted = [...articles].sort(
    (a, b) =>
      (a.level ? LEVEL_ORDER.indexOf(a.level) : 99) -
      (b.level ? LEVEL_ORDER.indexOf(b.level) : 99)
  );
  const categories = CATEGORIES.filter(
    (category) =>
      category.id !== 'other' ||
      articles.some((article) => categoryOf(article.id) === 'other')
  );
  const matches = sorted.filter(
    (article) =>
      (view.level === 'all' || article.level === view.level) &&
      (view.category === 'all' || categoryOf(article.id) === view.category) &&
      matchesGrammar(article, view.query)
  );
  useEffect(() => {
    if (status !== 'ready' || restored.current) return;
    if (navigationType !== 'POP' && !location.state?.grammarReturn) return;
    if (
      root.current?.contains(document.activeElement) &&
      document.activeElement?.matches('input,select,button')
    ) {
      restored.current = true;
      return;
    }
    const anchor = useGrammarView.getState().anchor;
    if (!anchor) return;
    const card = Array.from(
      root.current?.querySelectorAll<HTMLElement>('[data-grammar-id]') ?? []
    ).find((el) => el.dataset.grammarId === anchor.id);
    if (!card) return;
    const frame = requestAnimationFrame(() => {
      restored.current = true;
      card.focus({ preventScroll: true });
      window.scrollBy({
        top:
          card.getBoundingClientRect().top -
          Math.max(12, Math.min(anchor.top, innerHeight - 100)),
        behavior: 'instant',
      });
      card.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [status, articles, navigationType, location.state]);
  const reset = () => {
    view.reset();
    search.current?.focus();
  };
  return (
    <section
      ref={root}
      className="grammar-page"
      data-onboarding-ready={status === 'ready'}
      aria-label={ru ? 'Справочник по грамматике' : 'Grammar reference'}
    >
      <BackToReader />
      {source === 'progress' && <Link to="/progress" state={{progressReturn:true}} className="grammar-back">← {ru ? 'К прогрессу' : 'Back to progress'}</Link>}
      {dayHref && (
        <Link className="grammar-back" to={dayHref}>
          ← {ru ? 'Вернуться к учебному дню' : 'Back to your lesson'}
        </Link>
      )}
      <header className="grammar-header">
        <div>
          <h1>{ru ? 'Грамматика' : 'Grammar'}</h1>
          <p>
            {ru
              ? 'Разобраться в правиле. Узнать его в речи.'
              : 'Understand the rule. Recognize it in use.'}
          </p>
        </div>
        <div className="grammar-art" aria-hidden="true">
          <span>Aa</span>
          <i>→</i>
          <em>!</em>
        </div>
      </header>
      <div className="grammar-search">
        <label htmlFor="grammar-search">
          {ru
            ? 'Какое правило нужно вспомнить?'
            : 'Which rule do you want to look up?'}
        </label>
        <div>
          <PixelImage
            src="/assets/pixel/nav/grammar.png"
            alt=""
            className="h-6 w-6 shrink-0"
          />
          <input
            id="grammar-search"
            ref={search}
            type="search"
            autoComplete="off"
            placeholder={
              ru
                ? 'Например, «прошедшее» или Present Perfect'
                : 'For example, past tense or Present Perfect'
            }
            value={view.query}
            onChange={(event) => view.update({ query: event.target.value })}
          />
        </div>
      </div>
      <div className="grammar-level-row">
        <span>{ru ? 'Уровень' : 'Level'}</span>
        <div
          className="grammar-levels"
          role="group"
          aria-label={ru ? 'Уровень грамматики' : 'Grammar level'}
        >
          {[
            'all',
            ...LEVEL_ORDER.filter((level) =>
              articles.some((article) => article.level === level)
            ),
          ].map((level) => (
            <button
              key={level}
              type="button"
              aria-pressed={view.level === level}
              onClick={() => view.update({ level })}
            >
              {level === 'all' ? (ru ? 'Все' : 'All') : level}
            </button>
          ))}
        </div>
      </div>
      <div className="grammar-layout">
        <aside className="grammar-categories">
          <nav aria-label={ru ? 'Тематики грамматики' : 'Grammar categories'}>
            {categories.map((category) => (
              <button
                type="button"
                key={category.id}
                aria-pressed={view.category === category.id}
                onClick={() => view.update({ category: category.id })}
              >
                {ru ? category.ru : category.en}
                <span>
                  {status === 'ready'
                    ? articles.filter(
                        (article) =>
                          category.id === 'all' ||
                          categoryOf(article.id) === category.id
                      ).length
                    : '…'}
                </span>
              </button>
            ))}
          </nav>
          <label className="grammar-mobile-category">
            {ru ? 'Тематика' : 'Category'}
            <select
              value={view.category}
              onChange={(event) =>
                view.update({ category: event.target.value })
              }
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {ru ? category.ru : category.en}
                </option>
              ))}
            </select>
          </label>
          <p className="grammar-sidebar-note">
            {ru
              ? 'Справочник всегда под рукой. Прочитать правило можно в любом порядке.'
              : 'Always at hand. Read the rules in any order.'}
          </p>
        </aside>
        <div className="min-w-0">
          {status !== 'ready' ? (
            <GrammarState />
          ) : articles.length === 0 ? (
            <div className="grammar-empty">
              <span className="grammar-empty-symbol" aria-hidden="true">
                Aa
              </span>
              <h2>
                {ru ? 'Правила ещё не добавлены' : 'Articles are coming soon'}
              </h2>
              <p>
                {ru
                  ? 'Справочник загрузился, но статей в нём пока нет.'
                  : 'The reference loaded, but has no articles yet.'}
              </p>
              <Link to="/syllabus" className="grammar-action">
                {ru ? 'К учебному пути' : 'Go to the course'}
              </Link>
            </div>
          ) : matches.length === 0 ? (
            <div className="grammar-empty">
              <h2>{ru ? 'Ничего не найдено' : 'No topics found'}</h2>
              <p>
                {ru
                  ? 'Измените запрос или сбросьте фильтры. Можно искать на русском и английском.'
                  : 'Change your search or reset the filters. Search in Russian or English.'}
              </p>
              <Button onClick={reset}>
                {ru ? 'Сбросить поиск и фильтры' : 'Reset search and filters'}
              </Button>
            </div>
          ) : (
            <>
              <div className="grammar-result-heading">
                <h2>
                  {ru
                    ? categories.find(
                        (category) => category.id === view.category
                      )?.ru
                    : categories.find(
                        (category) => category.id === view.category
                      )?.en}
                </h2>
                <span role="status" aria-live="polite">
                  {matches.length} / {articles.length}
                </span>
              </div>
              <div className="grammar-grid">
                {matches.map((article) => {
                  const category = CATEGORIES.find(
                    (category) => category.id === categoryOf(article.id)
                  )!;
                  const example = article.blocks.flatMap(
                    (block) => block.examples ?? []
                  )[0];
                  return (
                    <Link
                      key={article.id}
                      className="grammar-card"
                      data-grammar-id={article.id}
                      to={grammarHref(article.id, source)}
                      onClick={(event) =>
                        useGrammarView.setState({
                          anchor: {
                            id: article.id,
                            top: event.currentTarget.getBoundingClientRect()
                              .top,
                          },
                        })
                      }
                    >
                      <div className="grammar-card-top">
                        {article.level && (
                          <span className="grammar-level">{article.level}</span>
                        )}
                        <span>{ru ? category.ru : category.en}</span>
                        <span className="grammar-arrow" aria-hidden="true">
                          ↗
                        </span>
                      </div>
                      <h3>{tr(article.title, lang)}</h3>
                      <p>{tr(article.summary, lang)}</p>
                      {example && (
                        <div className="grammar-card-example" lang="en">
                          {example.en}
                        </div>
                      )}
                    </Link>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <footer className="grammar-footer">
        <span>
          {ru ? 'Нужно применить правило?' : 'Ready to put it into practice?'}
        </span>
        <Link to={dayHref ?? '/syllabus'} className="grammar-action">
          {dayHref
            ? ru
              ? 'Вернуться к своему дню'
              : 'Back to your lesson'
            : ru
              ? 'Открыть учебный путь'
              : 'Open the course'}
        </Link>
      </footer>
    </section>
  );
}
