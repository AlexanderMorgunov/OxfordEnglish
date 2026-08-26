import { useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useContentStore } from '@/content/store';
import { useUiLang, tr } from '@/features/i18n/uiLang';
import { Card, Eyebrow, LevelDivider, PageStub, PixelImage } from '@/shared/ui';
import { LEVEL_ORDER } from '@/shared/levels';
import type { Level } from '@/content/schema';

export function GrammarIndexPage() {
  const { status, pack, load } = useContentStore();
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  useEffect(() => {
    void load();
  }, [load]);

  const articles = pack?.grammar ?? [];
  const byLevel = LEVEL_ORDER.map((lvl) => ({
    level: lvl as Level,
    items: articles.filter((a) => a.level === lvl),
  })).filter((g) => g.items.length > 0);
  const noLevel = articles.filter((a) => !a.level);

  return (
    <section aria-label="Grammar reference" className="max-w-prose">
      <Eyebrow className="mb-3.5">reference</Eyebrow>
      <div className="mb-2 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/grammar.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">
          {lang === 'ru' ? 'Справочник по грамматике' : 'Grammar reference'}
        </h1>
      </div>
      <p className="mb-8 text-muted text-pretty">
        {lang === 'ru'
          ? 'Подробные объяснения с примерами — можно вернуться и повторить в любой момент.'
          : 'Detailed explanations with examples — come back and review any time.'}
      </p>

      {status === 'loading' && (
        <p className="font-mono text-sm text-muted">loading…</p>
      )}
      {status === 'ready' && articles.length === 0 && (
        <p className="text-sm text-muted">
          {lang === 'ru' ? 'Статьи скоро появятся.' : 'Articles are coming soon.'}
        </p>
      )}

      {[...byLevel, ...(noLevel.length ? [{ level: null, items: noLevel }] : [])].map((group) => (
        <div key={group.level ?? 'other'} className="mb-8 flex flex-col gap-2.5">
          {group.level ? (
            <LevelDivider level={group.level} ru={ru} />
          ) : (
            <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
              {ru ? 'без уровня' : 'other'}
            </p>
          )}
          {group.items.map((a) => (
            <Link
              key={a.id}
              to={`/grammar/${a.id}`}
              className="group flex items-center justify-between rounded-md border border-line bg-surface px-4 py-3.5 transition-colors hover:border-teal-dim"
            >
              <span className="text-base">{tr(a.title, lang)}</span>
              <span className="max-w-[45%] truncate font-mono text-2xs text-muted">
                {tr(a.summary, lang)}
              </span>
            </Link>
          ))}
        </div>
      ))}
    </section>
  );
}

export function GrammarArticlePage() {
  const { articleId } = useParams();
  const [searchParams] = useSearchParams();
  const fromDay = searchParams.get('from');
  const { pack, load, status } = useContentStore();
  const lang = useUiLang((s) => s.lang);
  useEffect(() => {
    void load();
  }, [load]);

  if (status === 'idle' || status === 'loading') {
    return <p className="font-mono text-sm text-muted">loading…</p>;
  }

  const article = pack?.grammar.find((a) => a.id === articleId);
  if (!article) {
    return (
      <PageStub eyebrow="404" title={lang === 'ru' ? 'Статья не найдена' : 'Article not found'}>
        <Link to="/grammar" className="text-teal hover:underline">
          {lang === 'ru' ? '← ко всем статьям' : '← all articles'}
        </Link>
      </PageStub>
    );
  }

  const seeAlso = (article.seeAlso ?? [])
    .map((id) => pack?.grammar.find((a) => a.id === id))
    .filter((a): a is NonNullable<typeof a> => Boolean(a));

  return (
    <article className="max-w-prose">
      <div className="mb-4 flex flex-wrap gap-4">
        {fromDay && (
          <Link
            to={`/course/${fromDay.split('.')[0]}/day/${fromDay}`}
            className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
          >
            {lang === 'ru' ? '← вернуться к дню' : '← back to the day'}
          </Link>
        )}
        <Link
          to="/grammar"
          className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
        >
          {lang === 'ru' ? '← справочник' : '← reference'}
        </Link>
      </div>
      <h1 className="mb-2 text-2xl font-bold tracking-tight text-balance">
        {tr(article.title, lang)}
      </h1>
      <p className="mb-8 text-lg text-muted text-pretty">{tr(article.summary, lang)}</p>

      <div className="flex flex-col gap-8">
        {article.blocks.map((b, i) => (
          <div key={i}>
            {b.heading && (
              <h2 className="mb-2 text-lg font-semibold tracking-tight">
                {tr(b.heading, lang)}
              </h2>
            )}
            <p className="leading-relaxed text-pretty whitespace-pre-line">
              {tr(b.text, lang)}
            </p>
            {b.examples && b.examples.length > 0 && (
              <div className="mt-3 flex flex-col gap-1.5 rounded-md border border-line bg-surface p-4">
                {b.examples.map((ex, j) => (
                  <p key={j} className="text-sm">
                    <span className="font-mono text-teal">{ex.en}</span>
                    {ex.ru && <span className="text-muted"> — {ex.ru}</span>}
                  </p>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {article.pitfalls && article.pitfalls.length > 0 && (
        <Card className="mt-8 border-amber-dim bg-amber-dim/10">
          <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-amber">
            {lang === 'ru' ? 'частые ошибки' : 'common mistakes'}
          </p>
          <ul className="flex flex-col gap-2">
            {article.pitfalls.map((p, i) => (
              <li key={i} className="text-sm text-pretty">
                {tr(p, lang)}
              </li>
            ))}
          </ul>
        </Card>
      )}

      {seeAlso.length > 0 && (
        <div className="mt-8 border-t border-line pt-5">
          <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            {lang === 'ru' ? 'см. также' : 'see also'}
          </p>
          <div className="flex flex-wrap gap-2">
            {seeAlso.map((a) => (
              <Link
                key={a.id}
                to={`/grammar/${a.id}`}
                className="rounded-sm bg-surface-2 px-2.5 py-1.5 font-mono text-2xs text-teal hover:underline"
              >
                {tr(a.title, lang)}
              </Link>
            ))}
          </div>
        </div>
      )}
    </article>
  );
}
