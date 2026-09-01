/**
 * Post-build SEO pass: the app is a client-only SPA served from one bucket for all hosts, so search
 * engines only reliably see the STATIC HTML per URL. This writes a distinct dist/<route>.html for each
 * public route (correct self-canonical on the .ru origin, per-route <title>/description, noindex on
 * app-state pages) and a sitemap listing exactly the indexable routes — so route aliases and the
 * sitemap can never drift apart. Run after `vite build`; the deploy uploads dist/<route>.html to the
 * matching object key.
 *
 * The canonical origin is ALWAYS https://dayenglish.ru — that single tag self-canonicals on .ru and
 * cross-domain-canonicals .online at once, so it must never become origin-relative.
 *
 * The grammar reference is programmatic SEO: one indexable page per topic under /grammar/<id>. Because
 * robots.txt disallows /packs/, a crawler cannot fetch the pack the SPA renders from — so these pages
 * must ship the article TEXT in the static HTML, not just meta. We inject semantic HTML into
 * `<div id="root">` straight from grammar.json; main.tsx mounts with createRoot().render() (not
 * hydrateRoot), which replaces the container's children on first paint, so the injected content is a
 * crawler-visible, no-mismatch placeholder. The /grammar hub gets the full topic link list for the
 * same reason — without it the 47 pages have no crawlable internal links.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIST = join(HERE, '..', 'dist');
const ORIGIN = 'https://dayenglish.ru';
const GRAMMAR_JSON = join(HERE, '..', 'public', 'packs', 'dev-english-a2', 'grammar.json');

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** JSON-LD embedded in <script>: keep it valid JSON but neutralise a stray `</script>` / `<`. */
const jsonld = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

const SHELL = readFileSync(join(DIST, 'index.html'), 'utf8');

const CANON = '<link rel="canonical" href="https://dayenglish.ru/" />';
const OGURL = '<meta property="og:url" content="https://dayenglish.ru/" />';
const ROBOTS = '<meta name="robots" content="index, follow" />';
const ROOT = '<div id="root"></div>';
const TITLE = /<title>[^<]*<\/title>/;
const DESC = /<meta name="description" content="[^"]*" \/>/;
const OGTITLE = /<meta property="og:title" content="[^"]*" \/>/;
const OGDESC = /<meta property="og:description" content="[^"]*" \/>/;

function must(hay, needle, label) {
  if (!hay.includes(needle)) throw new Error(`build-seo: expected ${label} string not found in index.html`);
}
must(SHELL, CANON, 'canonical');
must(SHELL, OGURL, 'og:url');
must(SHELL, ROBOTS, 'robots');
must(SHELL, ROOT, 'root div');
if (!TITLE.test(SHELL) || !DESC.test(SHELL)) throw new Error('build-seo: title/description not found');

/** Clone the shell into a concrete page: per-URL canonical/og/title/description, optional noindex,
 *  optional JSON-LD before </head>, optional prerendered body inside #root. */
function renderPage({ url, title, desc, index = true, ldjson, body }) {
  let html = SHELL
    .replace(CANON, `<link rel="canonical" href="${url}" />`)
    .replace(OGURL, `<meta property="og:url" content="${url}" />`)
    .replace(TITLE, `<title>${esc(title)}</title>`)
    .replace(OGTITLE, `<meta property="og:title" content="${esc(title)}" />`);
  if (desc) {
    html = html
      .replace(DESC, `<meta name="description" content="${esc(desc)}" />`)
      .replace(OGDESC, `<meta property="og:description" content="${esc(desc)}" />`);
  }
  if (!index) html = html.replace(ROBOTS, '<meta name="robots" content="noindex, follow" />');
  if (ldjson) {
    html = html.replace(
      '</head>',
      `  <script type="application/ld+json">${jsonld(ldjson)}</script>\n  </head>`
    );
  }
  if (body) html = html.replace(ROOT, `<div id="root">${body}</div>`);
  return html;
}

// ── Flat routes (home is index.html itself; these are the extra keys) ──────────────────────────────
const ROUTES = [
  {
    key: 'grammar', index: true,
    title: 'Грамматика английского языка — справочник с примерами | DayEnglish',
    desc: 'Понятные объяснения грамматики английского с примерами на русском: времена, артикли, предлоги, модальные глаголы. Бесплатно, без регистрации.',
  },
  {
    key: 'library', index: true,
    title: 'Читать книги на английском с переводом — библиотека | DayEnglish',
    desc: 'Бесплатная читалка: книги на английском с переводом слов и фраз по клику, озвучкой и закладками. Учите английский язык через чтение.',
  },
  { key: 'support', index: false, title: 'Поддержать проект | DayEnglish' },
  { key: 'credits', index: false, title: 'Благодарности и источники | DayEnglish' },
  { key: 'feedback', index: false, title: 'Обратная связь | DayEnglish' },
  { key: 'review', index: false, title: 'Повторение слов | DayEnglish' },
  { key: 'progress', index: false, title: 'Мой прогресс | DayEnglish' },
  { key: 'vocabulary', index: false, title: 'Мой словарь | DayEnglish' },
  { key: 'settings', index: false, title: 'Настройки | DayEnglish' },
];

// ── Grammar topics (programmatic SEO) ──────────────────────────────────────────────────────────────
let grammar = [];
try {
  grammar = JSON.parse(readFileSync(GRAMMAR_JSON, 'utf8')).filter((a) => /^[a-z0-9-]+$/.test(a.id));
} catch {
  console.warn('build-seo: grammar.json not readable — skipping grammar topic pages.');
}
const titleOf = new Map(grammar.map((a) => [a.id, a.title?.ru || a.title?.en || a.id]));

/** ~160-char, naturally-unique description: the summary followed by the start of the first block. */
function topicDesc(a) {
  const lead = (a.summary?.ru || '').trim();
  const more = (a.blocks?.[0]?.text?.ru || '').replace(/\s+/g, ' ').trim();
  const full = `${lead} ${more}`.replace(/\s+/g, ' ').trim();
  return full.length > 158 ? `${full.slice(0, 157).trimEnd()}…` : full;
}

function paras(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((p) => p.replace(/\n/g, ' ').trim())
    .filter(Boolean)
    .map((p) => `<p>${esc(p)}</p>`)
    .join('');
}

function topicBody(a) {
  const blocks = (a.blocks || [])
    .map((b) => {
      const ex = (b.examples || [])
        .map((e) => `<li><strong>${esc(e.en)}</strong> — ${esc(e.ru)}</li>`)
        .join('');
      return `<section><h2>${esc(b.heading?.ru || '')}</h2>${paras(b.text?.ru)}${
        ex ? `<ul>${ex}</ul>` : ''
      }</section>`;
    })
    .join('');
  const pit = (a.pitfalls || []).map((p) => `<li>${esc(p.ru)}</li>`).join('');
  const see = (a.seeAlso || [])
    .filter((id) => titleOf.has(id))
    .map((id) => `<li><a href="/grammar/${id}">${esc(titleOf.get(id))}</a></li>`)
    .join('');
  return (
    `<main><nav><a href="/grammar">← Грамматика английского</a></nav>` +
    `<article><h1>${esc(a.title?.ru || '')}</h1><p>${esc(a.summary?.ru || '')}</p>` +
    blocks +
    (pit ? `<section><h2>Частые ошибки</h2><ul>${pit}</ul></section>` : '') +
    (see ? `<nav aria-label="Смотрите также"><h2>Смотрите также</h2><ul>${see}</ul></nav>` : '') +
    `<p><a href="/">Начать учить английский бесплатно →</a></p></article></main>`
  );
}

function topicLd(a, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: a.title?.ru || a.title?.en || a.id,
    description: (a.summary?.ru || '').trim(),
    url,
    inLanguage: 'ru',
    educationalLevel: a.level || undefined,
    learningResourceType: 'Grammar reference',
    isAccessibleForFree: true,
    isPartOf: { '@type': 'WebSite', '@id': 'https://dayenglish.ru/#website' },
    provider: { '@type': 'Organization', name: 'DayEnglish' },
  };
}

// /grammar hub body: h1 + the full crawlable topic link list (internal-linking is the point).
const hubBody =
  `<main><h1>Грамматика английского языка</h1>` +
  `<p>Справочник грамматики английского с примерами и переводом на русский — ${grammar.length} тем от A2 до B2, бесплатно и без регистрации.</p>` +
  `<ul>` +
  grammar
    .map((a) => `<li><a href="/grammar/${a.id}">${esc(a.title?.ru || a.id)}</a> — ${esc(a.summary?.ru || '')}</li>`)
    .join('') +
  `</ul></main>`;

// ── Write pages ──────────────────────────────────────────────────────────────────────────────────
for (const r of ROUTES) {
  const url = `${ORIGIN}/${r.key}`;
  const body = r.key === 'grammar' && grammar.length ? hubBody : undefined;
  writeFileSync(join(DIST, `${r.key}.html`), renderPage({ ...r, url, body }));
}

if (grammar.length) {
  mkdirSync(join(DIST, 'grammar'), { recursive: true });
  for (const a of grammar) {
    const url = `${ORIGIN}/grammar/${a.id}`;
    const html = renderPage({
      url,
      title: `${a.title?.ru || a.id} — правила и примеры | DayEnglish`,
      desc: topicDesc(a),
      index: true,
      ldjson: topicLd(a, url),
      body: topicBody(a),
    });
    writeFileSync(join(DIST, 'grammar', `${a.id}.html`), html);
  }
}

// ── Sitemap: home + indexable flat routes + every grammar topic ────────────────────────────────────
const lastmod = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: `${ORIGIN}/`, priority: '1.0', changefreq: 'weekly' },
  ...ROUTES.filter((r) => r.index).map((r) => ({ loc: `${ORIGIN}/${r.key}`, priority: '0.8', changefreq: 'monthly' })),
  ...grammar.map((a) => ({ loc: `${ORIGIN}/grammar/${a.id}`, priority: '0.7', changefreq: 'monthly' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n    <changefreq>${u.changefreq}</changefreq>\n  </url>`)
  .join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

console.log(
  `build-seo: wrote ${ROUTES.length} flat routes + ${grammar.length} grammar topics + sitemap (${urls.length} urls, lastmod ${lastmod}).`
);
