import { useEffect, useRef } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import type { MouseEvent } from 'react';
import { useGrammarStore } from '@/content/grammarStore';
import { tr, useUiLang } from '@/features/i18n/uiLang';
import { BackToReader } from '@/features/reader/BackToReader';
import { PageStub } from '@/shared/ui';
import { CATEGORIES, categoryOf, grammarHref } from './model';
import { useGrammarSource } from './useGrammarSource';
import { GrammarState } from './GrammarState';
import './grammar.css';

export function GrammarArticlePage() {
  const { articleId } = useParams();
  const location = useLocation();
  const { status, articles, load } = useGrammarStore();
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const { source, dayHref } = useGrammarSource();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    void load();
  }, [load]);
  const article = articles.find((article) => article.id === articleId);
  useEffect(() => {
    if (status !== 'ready') return;
    const frame = requestAnimationFrame(() => {
      const target =
        (location.hash
          ? document.getElementById(location.hash.slice(1))
          : null) ?? heading.current;
      target?.focus({ preventScroll: true });
      if (location.hash) target?.scrollIntoView({ block: 'start' });
    });
    return () => cancelAnimationFrame(frame);
  }, [articleId, status, location.hash]);
  const indexHref = grammarHref(null, source);
  const back = (
    <div className="grammar-back-row">
      <BackToReader />
      {source === 'progress' && <Link to="/progress" state={{progressReturn:true}} className="grammar-back">← {ru ? 'К прогрессу' : 'Back to progress'}</Link>}
      {dayHref && (
        <Link to={dayHref} className="grammar-back">
          ← {ru ? 'Вернуться к учебному дню' : 'Back to your lesson'}
        </Link>
      )}
      <Link to={indexHref} state={{ grammarReturn: true }} className="grammar-back">
        ← {ru ? 'Все правила' : 'All rules'}
      </Link>
    </div>
  );
  if (status !== 'ready')
    return (
      <section className="grammar-page">
        {back}
        <GrammarState />
      </section>
    );
  if (!article)
    return (
      <PageStub
        eyebrow="404"
        title={ru ? 'Статья не найдена' : 'Article not found'}
      >
        <Link to={indexHref} state={{ grammarReturn: true }} className="grammar-back">
          {ru ? '← Ко всем правилам' : '← All rules'}
        </Link>
        {dayHref && (
          <Link to={dayHref} className="grammar-back">
            {ru ? 'Вернуться к учебному дню' : 'Back to your lesson'}
          </Link>
        )}
      </PageStub>
    );
  const related = [...new Set(article.seeAlso ?? [])]
    .map((id) => articles.find((a) => a.id === id))
    .filter((a) => a && a.id !== article.id);
  const category = CATEGORIES.find(
    (category) => category.id === categoryOf(article.id)
  )!;
  const sections = article.blocks.map((block, index) => ({
    id: `grammar-block-${index}`,
    title: block.heading
      ? tr(block.heading, lang)
      : `${ru ? 'Правило' : 'The rule'}${article.blocks.length > 1 ? ` ${index + 1}` : ''}`,
  }));
  if (article.pitfalls?.length)
    sections.push({
      id: 'grammar-pitfalls',
      title: ru ? 'Частые ошибки' : 'Common mistakes',
    });
  if (related.length)
    sections.push({
      id: 'grammar-related',
      title: ru ? 'Рядом по смыслу' : 'Related topics',
    });
  const anchor = (event: MouseEvent<HTMLAnchorElement>, id: string) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    const details = event.currentTarget.closest('details');
    if (details) details.open = false;
    window.history.replaceState(
      window.history.state,
      '',
      `${location.pathname}${location.search}#${id}`
    );
    requestAnimationFrame(() => {
      const target = document.getElementById(id);
      target?.focus({ preventScroll: true });
      target?.scrollIntoView({ block: 'start' });
    });
  };
  const toc = (label: string) => (
    <nav aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          onClick={(event) => anchor(event, section.id)}
        >
          {section.title}
        </a>
      ))}
    </nav>
  );
  return (
    <section className="grammar-page">
      {back}
      <div className="grammar-article-layout">
        <article className="grammar-article">
          <header>
            <p className="grammar-article-eyebrow">
              {article.level && (
                <span className="grammar-level">{article.level}</span>
              )}
              {ru ? category.ru : category.en}
            </p>
            <h1 ref={heading} tabIndex={-1}>
              {tr(article.title, lang)}
            </h1>
            <p className="grammar-article-lead">{tr(article.summary, lang)}</p>
          </header>
          <details className="grammar-mobile-toc">
            <summary>{ru ? 'В этом правиле' : 'In this rule'}</summary>
            {toc(
              ru ? 'Содержание правила на телефоне' : 'Rule contents on mobile'
            )}
          </details>
          {article.blocks.map((block, index) => (
            <section
              key={index}
              className="grammar-section"
              aria-labelledby={`grammar-block-${index}`}
            >
              <h2 id={`grammar-block-${index}`} tabIndex={-1}>
                {sections[index]!.title}
              </h2>
              <p className="grammar-explanation">{tr(block.text, lang)}</p>
              {block.examples?.length ? (
                <div
                  className={
                    index === 0
                      ? 'grammar-examples grammar-examples-hero'
                      : 'grammar-examples'
                  }
                >
                  {block.examples.map((example, i) => (
                    <div key={i}>
                      <p lang="en">{example.en}</p>
                      {example.ru && (
                        <p lang="ru" className="grammar-translation">
                          {example.ru}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              ) : null}
            </section>
          ))}
          {!!article.pitfalls?.length && (
            <section
              className="grammar-mistakes"
              aria-labelledby="grammar-pitfalls"
            >
              <h2 id="grammar-pitfalls" tabIndex={-1}>
                {ru ? 'Частые ошибки' : 'Common mistakes'}
              </h2>
              <ul>
                {article.pitfalls.map((pitfall, index) => (
                  <li key={index}>{tr(pitfall, lang)}</li>
                ))}
              </ul>
            </section>
          )}
          {!!related.length && (
            <section
              className="grammar-related"
              aria-labelledby="grammar-related"
            >
              <h2 id="grammar-related" tabIndex={-1}>
                {ru ? 'Рядом по смыслу' : 'Related topics'}
              </h2>
              <div>
                {related.map(
                  (other) =>
                    other && (
                      <Link key={other.id} to={grammarHref(other.id, source)}>
                        {tr(other.title, lang)}{' '}
                        <span aria-hidden="true">→</span>
                      </Link>
                    )
                )}
              </div>
            </section>
          )}
          <footer className="grammar-footer">
            <Link to={indexHref} state={{ grammarReturn: true }} className="grammar-back">
              ← {ru ? 'К списку правил' : 'Back to all rules'}
            </Link>
            <Link to={dayHref ?? '/syllabus'} className="grammar-action">
              {dayHref
                ? ru
                  ? 'Вернуться к учебному дню'
                  : 'Back to your lesson'
                : ru
                  ? 'К учебному пути'
                  : 'Go to the course'}
            </Link>
          </footer>
        </article>
        <aside className="grammar-desktop-toc">
          <p>{ru ? 'В этом правиле' : 'In this rule'}</p>
          {toc(ru ? 'Содержание правила' : 'Rule contents')}
          <p className="grammar-toc-note">
            {ru
              ? 'Можно вернуться к примерам в любой момент.'
              : 'Come back to the examples whenever you need them.'}
          </p>
        </aside>
      </div>
    </section>
  );
}
