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
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const ORIGIN = 'https://dayenglish.ru';

// Home is index.html itself (canonical /, indexable). These are the extra route keys.
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

const SHELL = readFileSync(join(DIST, 'index.html'), 'utf8');

const CANON = '<link rel="canonical" href="https://dayenglish.ru/" />';
const OGURL = '<meta property="og:url" content="https://dayenglish.ru/" />';
const ROBOTS = '<meta name="robots" content="index, follow" />';
const TITLE = /<title>[^<]*<\/title>/;
const DESC = /<meta name="description" content="[^"]*" \/>/;

function must(hay, needle, label) {
  if (!hay.includes(needle)) throw new Error(`build-seo: expected ${label} string not found in index.html`);
}
must(SHELL, CANON, 'canonical');
must(SHELL, OGURL, 'og:url');
must(SHELL, ROBOTS, 'robots');
if (!TITLE.test(SHELL) || !DESC.test(SHELL)) throw new Error('build-seo: title/description not found');

for (const r of ROUTES) {
  const url = `${ORIGIN}/${r.key}`;
  let html = SHELL
    .replace(CANON, `<link rel="canonical" href="${url}" />`)
    .replace(OGURL, `<meta property="og:url" content="${url}" />`)
    .replace(TITLE, `<title>${r.title}</title>`);
  if (r.desc) html = html.replace(DESC, `<meta name="description" content="${r.desc}" />`);
  if (!r.index) html = html.replace(ROBOTS, '<meta name="robots" content="noindex, follow" />');
  writeFileSync(join(DIST, `${r.key}.html`), html);
}

// Sitemap: home + the indexable routes only (never list a noindex/soft-404 URL).
const lastmod = new Date().toISOString().slice(0, 10);
const urls = [
  { loc: `${ORIGIN}/`, priority: '1.0', changefreq: 'weekly' },
  ...ROUTES.filter((r) => r.index).map((r) => ({ loc: `${ORIGIN}/${r.key}`, priority: '0.8', changefreq: 'monthly' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n    <changefreq>${u.changefreq}</changefreq>\n  </url>`)
  .join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

console.log(`build-seo: wrote ${ROUTES.length} route HTML files + sitemap (${urls.length} urls, lastmod ${lastmod}).`);
