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
 * The grammar reference is programmatic SEO: one indexable page per topic under /grammar/<id>. We inject
 * semantic HTML into `<div id="root">` straight from grammar.json, and the /grammar hub gets the full
 * topic link list so those pages have crawlable internal links.
 *
 * What that injected body is NOT is a safety net for Googlebot. main.tsx mounts with createRoot (not
 * hydrateRoot), which replaces the container's children on first paint — and Googlebot runs the JS and
 * indexes the RESULT. An earlier version of this comment claimed the opposite, and the cost was real:
 * robots.txt disallowed /packs/, the page rendered from the pack, the fetch never happened for the
 * crawler, and all 48 topics indexed as "article not found" (Search Console, 2026-09-24 — 9 pages
 * indexed, 81 not).
 *
 * So the rule this file exists under: EVERY indexable page must render correctly from resources a
 * crawler is allowed to fetch. The prerendered body serves no-JS clients and link previews; it does not
 * excuse the rendered page from working. robots.txt now opens grammar.json specifically, and
 * `loadGrammarOnly` reads it without the other 213 pack files.
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
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
  if (body) {
    // #root now carries page-specific content that no-JS crawlers can read, so the shell's generic
    // home <noscript> fallback (its own <h1> + home copy) would only add a duplicate h1 and off-topic
    // boilerplate to every topic/hub page. Drop it here; pages WITHOUT a body keep it as their fallback.
    html = html.replace(/\n?\s*<noscript>[\s\S]*?<\/noscript>/, '').replace(ROOT, `<div id="root">${body}</div>`);
  }
  return html;
}

// ── Flat routes (home is index.html itself; these are the extra keys) ──────────────────────────────
const ROUTES = [
  {
    key: 'about', index: true,
    title: 'DayEnglish — как работает бесплатное приложение для английского',
    desc: 'Подробно о DayEnglish: курс A1 → B2, читалка книг с переводом по клику, интервальные повторения, офлайн и без регистрации. Что внутри и с чего начать.',
  },
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
  {
    key: 'privacy', index: true,
    title: 'Политика конфиденциальности | DayEnglish',
    desc: 'Как DayEnglish обрабатывает данные: без email и персональных данных, аккаунт по ключу восстановления, хранение в РФ. Приложением можно пользоваться без регистрации.',
  },
  {
    key: 'terms', index: true,
    title: 'Условия оказания услуг и публичная оферта | DayEnglish',
    desc: 'Условия подписки DayEnglish Pro: что входит, сколько стоит, как отказаться и вернуть деньги. Реквизиты исполнителя и полный текст публичной оферты.',
  },
  {
    key: 'pro', index: true,
    title: 'DayEnglish Pro — подписка с ИИ-разборами | DayEnglish',
    desc: 'Что бесплатно всегда, что даёт аккаунт и зачем нужна подписка Pro. Разборы грамматики, упрощение текста и перевод в контексте — на своём ключе бесплатно или на нашем по подписке.',
  },
  { key: 'support', index: false, title: 'Поддержать проект | DayEnglish' },
  { key: 'credits', index: false, title: 'Благодарности и источники | DayEnglish' },
  { key: 'feedback', index: false, title: 'Обратная связь | DayEnglish' },
  { key: 'review', index: false, title: 'Повторение слов | DayEnglish' },
  { key: 'progress', index: false, title: 'Мой прогресс | DayEnglish' },
  { key: 'vocabulary', index: false, title: 'Мой словарь | DayEnglish' },
  { key: 'settings', index: false, title: 'Настройки | DayEnglish' },
  // Where the acquirer returns the payer. Static hosting answers a missing key with a soft-404, and a
  // 404 is not what someone should meet straight after being charged — so these get real 200 objects
  // like every other SPA route. Never indexable.
  { key: 'billing/success', index: false, title: 'Оплата | DayEnglish' },
  { key: 'billing/fail', index: false, title: 'Оплата не прошла | DayEnglish' },
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

// ── Reading catalog (programmatic SEO for /library) ────────────────────────────────────────────────
const CATALOG_JSON = join(HERE, '..', 'public', 'reader', 'catalog.json');
const CATALOG_DIR = join(HERE, '..', 'public', 'reader', 'catalog');
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
let catalog = [];
try {
  const raw = JSON.parse(readFileSync(CATALOG_JSON, 'utf8'));
  catalog = (raw.books || raw).filter((b) => /^[a-z0-9-]+$/.test(b.id));
  catalog.sort((a, b) => LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) || a.title.localeCompare(b.title));
} catch {
  console.warn('build-seo: reader/catalog.json not readable — skipping library pages.');
}

/** First couple of paragraphs of a bundled book (its JSON lives under /public/reader/, readable at
 *  build). Gives each bundled book landing real, unique English content; remote books have none locally. */
function bookPreview(entry) {
  if (entry.kind !== 'bundled' || !entry.path) return '';
  try {
    const book = JSON.parse(readFileSync(join(HERE, '..', 'public', entry.path), 'utf8'));
    const text = book.chapters?.[0]?.text || '';
    const ps = text.split(/\n{2,}/).map((p) => p.replace(/\n/g, ' ').trim()).filter(Boolean).slice(0, 2);
    const joined = ps.join(' ');
    const clipped = joined.length > 420 ? `${joined.slice(0, 419).trimEnd()}…` : joined;
    return clipped ? `<h2>Начало книги</h2><p>${esc(clipped)}</p>` : '';
  } catch {
    return '';
  }
}

function bookBody(b) {
  const by = b.author ? `${esc(b.author)} · ` : '';
  return (
    `<main><nav><a href="/library">← Книги на английском</a></nav>` +
    `<article><h1>${esc(b.title)}</h1>` +
    `<p>${by}уровень ${esc(b.level)}</p>` +
    `<p>Читайте «${esc(b.title)}» на английском прямо в браузере: перевод слов и фраз по клику, озвучка и закладки. Бесплатно, без регистрации.</p>` +
    bookPreview(b) +
    (b.license?.sourceUrl
      ? `<p><small>Источник: ${esc(b.license?.attribution || '')} — <a href="${esc(b.license.sourceUrl)}" rel="nofollow">оригинал</a>.</small></p>`
      : '') +
    `</article></main>`
  );
}

function bookLd(b, url) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Book',
    name: b.title,
    author: b.author ? { '@type': 'Person', name: b.author } : undefined,
    inLanguage: 'en',
    url,
    isAccessibleForFree: true,
    learningResourceType: 'Graded reader',
    isPartOf: { '@type': 'WebSite', '@id': 'https://dayenglish.ru/#website' },
  };
}

const libraryHubBody =
  `<main><h1>Книги на английском для чтения — с переводом</h1>` +
  `<p>Бесплатная читалка: ${catalog.length} книг на английском (public domain и CC-BY) с переводом слов и фраз по клику, озвучкой и закладками. Уровни A2–C1, для любого уровня.</p>` +
  `<ul>` +
  catalog
    .map(
      (b) =>
        `<li><a href="/library/catalog/${b.id}">«${esc(b.title)}»${b.author ? ` — ${esc(b.author)}` : ''}</a> · ${esc(b.level)}</li>`
    )
    .join('') +
  `</ul></main>`;

/** The landing's copy as crawlable HTML. Keep in sync with src/pages/AboutPage.tsx — the SPA replaces
 *  this on mount, so it exists purely for search engines and no-JS visitors. */
// The acquirer's moderation checks that the site itself carries contacts, the price, the seller's
// details and the refund procedure. React renders all of that, but a checker that does not run JS would
// see an empty shell — so the four required facts are prerendered here too. Keep in step with
// src/pages/TermsPage.tsx.
const termsBody =
  `<main><h1>Условия оказания услуг и публичная оферта</h1>` +
  `<p>Приложение DayEnglish бесплатно. Платная подписка DayEnglish Pro стоит 199 ₽ за 30 дней, открывает функции на основе искусственного интеллекта, не продлевается автоматически и возвращается за неиспользованный период.</p>` +
  `<h2>Услуга и стоимость</h2>` +
  `<ul><li><strong>DayEnglish Pro — 199 ₽ за расчётный период в 30 дней.</strong> В период включено 10 000 единиц ИИ-запросов.</li>` +
  `<li>Функции на основе ИИ: разбор грамматики предложения, упрощение текста до уровня изучающего, перевод слова с учётом контекста предложения — на ключе Исполнителя, без настройки со стороны Заказчика.</li>` +
  `<li>Синхронизация и резервное копирование: прогресс, словарь и позиции чтения между устройствами, облачная копия, синхронизация файлов книг (до 20 МБ на книгу и до 300 МБ на аккаунт).</li>` +
  `<li>По окончании оплаченного периода синхронизация прекращается, но облачная копия не удаляется — её по-прежнему можно загрузить на устройство.</li>` +
  `<li>Пробный период: 14 дней бесплатно, без привязки карты, бюджет 1 000 единиц (разовый, не обновляется).</li>` +
  `<li>Подписка не продлевается автоматически: по окончании оплаченного периода доступ прекращается, следующий период оплачивается вручную.</li>` +
  `<li>Оплата банковской картой или через СБП, платёжный сервис Robokassa; кассовый чек формирует и направляет платёжный сервис.</li>` +
  `<li>Курс, читалка, интервальные повторения, словарь и справочник грамматики бесплатны и работают без оплаты и без аккаунта, на одном устройстве. Восстановление доступа к аккаунту через приложение-аутентификатор также бесплатно.</li></ul>` +
  `<h2>Отказ от услуги и возврат денежных средств</h2>` +
  `<p>Отказаться можно в любой момент: автоматическое продление не применяется, достаточно не оплачивать следующий период. Возврат за неиспользованную часть оплаченного периода производится по заявлению на morgunowalex@gmail.com с указанием даты и суммы платежа. Срок рассмотрения — 10 рабочих дней; при положительном решении деньги возвращаются тем же способом, которым была произведена оплата, в срок не более 10 рабочих дней. Сумма рассчитывается пропорционально полным дням, оставшимся до конца оплаченного периода. Если платные функции были недоступны по вине Исполнителя, оплата возвращается полностью.</p>` +
  `<h2>Реквизиты Исполнителя</h2>` +
  `<p>Моргунов Александр Сергеевич, самозанятый (плательщик налога на профессиональный доход).<br>` +
  `ИНН: 361302397520<br>` +
  `ОГРН/ОГРНИП: не применимо — Исполнитель является физическим лицом, применяющим специальный налоговый режим «Налог на профессиональный доход».<br>` +
  `Контактный e-mail: <a href="mailto:morgunowalex@gmail.com">morgunowalex@gmail.com</a><br>` +
  `Контактный телефон: +7 995 040-35-70<br>` +
  `Сайт: https://dayenglish.ru</p>` +
  `<p>Полный текст публичной оферты о заключении договора об оказании услуг опубликован на этой странице.</p></main>`;

const aboutBody =
  `<main><h1>DayEnglish — английский по одному дню за раз</h1>` +
  `<p>Бесплатный курс английского от A1 до B2 и читалка книг в одном приложении: слова, которые встретились вам в тексте, попадают в интервальные повторения и возвращаются, пока не запомнятся. Без рекламы, без регистрации, работает офлайн.</p>` +
  `<h2>Как это работает</h2>` +
  `<ol><li><strong>Короткий тест уровня.</strong> Пять минут — и понятно, с какого дня начинать: от полного нуля (A1) до уверенного B1.</li>` +
  `<li><strong>Учебный день по 15 минут.</strong> Новые слова, грамматика, чтение и аудирование одним маршрутом.</li>` +
  `<li><strong>Своя книга в читалке.</strong> Слова из книги попадают в повторения и возвращаются вовремя.</li></ol>` +
  `<h2>Что внутри</h2>` +
  `<ul><li>Курс A1 → B2: учебные дни с упражнениями девяти типов и контрольными в конце юнитов.</li>` +
  `<li><a href="/grammar">Справочник грамматики английского</a> с объяснениями на русском и примерами.</li>` +
  `<li><a href="/library">Читалка книг</a>: EPUB, FB2, DOCX и PDF плюс встроенная библиотека, перевод по клику, озвучка и закладки.</li>` +
  `<li>Интервальные повторения по алгоритму FSRS.</li>` +
  `<li>Выделение фраз: отметьте первое и последнее слово — идиома сохранится целиком, с переводом, и попадёт в повторения.</li>` +
  `<li>Словарь с уровнем слова по шкале CEFR и формами неправильных глаголов: go — went — gone.</li>` +
  `<li>Статистика чтения: время считается только когда вы действительно читаете.</li>` +
  `<li>Аудирование, чтение вслух и — по желанию, на вашем ключе — подсказки ИИ.</li></ul>` +
  `<h2>Ваши данные остаются вашими</h2>` +
  `<ul><li>Прогресс, словарь и книги хранятся в браузере на вашем устройстве.</li>` +
  `<li>Аккаунт не нужен; анонимную статистику можно выключить в настройках.</li>` +
  `<li>Прогресс выгружается в файл и переносится на другое устройство.</li></ul>` +
  `<h2>Частые вопросы</h2>` +
  `<p><strong>Сколько это стоит?</strong> Курс, читалка, повторения и словарь — бесплатно, без рекламы и платных уровней. Отдельно есть необязательная подписка <a href="/pro">DayEnglish Pro</a> с разборами на основе ИИ; те же функции доступны и со своим ключом ИИ.</p>` +
  `<p><strong>Нужна ли регистрация?</strong> Нет, прогресс хранится в браузере и выгружается файлом.</p>` +
  `<p><strong>Работает ли без интернета?</strong> Да, после первой загрузки.</p>` +
  `<p><strong>Мои книги куда-то загружаются?</strong> Нет, импортированные книги остаются на вашем устройстве.</p>` +
  `<p><strong>С какого уровня можно начать?</strong> С нуля: есть тир A1, дальше A2, B1 и B2.</p>` +
  `<p><a href="/">Начать учить английский бесплатно →</a></p></main>`;

// Without a body of their own these two kept the shell's home <noscript>: the home <h1> and the whole
// home pitch, word for word. Two of the six indexable flat pages had no sentence of their own.
const privacyBody =
  `<main><h1>Политика конфиденциальности DayEnglish</h1>` +
  `<p>Коротко: приложение не спрашивает ни почту, ни телефон, а учиться можно вообще без аккаунта. Полный текст — ниже на этой странице.</p>` +
  `<h2>Какие данные мы не собираем</h2>` +
  `<ul><li>Ни адреса почты, ни номера телефона, ни имени — аккаунт состоит из одного ключа восстановления.</li>` +
  `<li>Прогресс, словарь и закладки хранятся в браузере на вашем устройстве.</li>` +
  `<li>Импортированные книги остаются на устройстве и никуда не загружаются, пока вы сами не включите синхронизацию.</li></ul>` +
  `<h2>Что происходит с аккаунтом</h2>` +
  `<p>Аккаунт нужен только для синхронизации между устройствами. Сам ключ восстановления мы не храним — на сервере лежит только его односторонний хеш. Данные хранятся в России.</p>` +
  `<p>Анонимную статистику можно выключить в настройках, и браузерный запрет отслеживания мы уважаем.</p>` +
  `<p><a href="/terms">Условия и публичная оферта</a> · <a href="/">Начать бесплатно</a></p></main>`;

const proBody =
  `<main><h1>DayEnglish Pro — что бесплатно и за что подписка</h1>` +
  `<p>Курс, читалка, повторения и словарь бесплатны и останутся бесплатными. Подписка оплачивает серверы и ключ ИИ — она не запирает учёбу.</p>` +
  `<h2>Бесплатно всегда</h2>` +
  `<ul><li>Курс английского от A1 до B2 — учебные дни с упражнениями, грамматикой, чтением и аудированием.</li>` +
  `<li><a href="/library">Читалка</a>: свои книги в EPUB, FB2, DOCX и PDF плюс встроенный каталог, перевод слов по клику.</li>` +
  `<li>Интервальные повторения по алгоритму FSRS и личный словарь.</li>` +
  `<li><a href="/grammar">Справочник грамматики</a> с объяснениями на русском.</li>` +
  `<li>Всё это офлайн и без аккаунта.</li></ul>` +
  `<h2>Что даёт подписка</h2>` +
  `<ul><li>Разборы на основе ИИ без своего ключа и без VPN: перевод слова с учётом контекста, упрощение сложного предложения, объяснение грамматики.</li>` +
  `<li>Синхронизация прогресса, словаря, закладок и позиций чтения между устройствами.</li>` +
  `<li>Резервная копия в облаке, включая файлы загруженных книг.</li></ul>` +
  `<p>К разборам есть и бесплатный путь — свой ключ ИИ. У синхронизации его нет: она работает на нашем сервере и в нашем хранилище.</p>` +
  `<p><a href="/terms">Условия и публичная оферта</a> · <a href="/about">Подробнее о приложении</a></p></main>`;

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
  const bodies = {
    terms: termsBody,
    about: aboutBody,
    privacy: privacyBody,
    pro: proBody,
    ...(grammar.length && { grammar: hubBody }),
    ...(catalog.length && { library: libraryHubBody }),
  };
  const body = bodies[r.key];
  const out = join(DIST, `${r.key}.html`);
  mkdirSync(dirname(out), { recursive: true }); // a nested key (billing/success) has no directory yet
  writeFileSync(out, renderPage({ ...r, url, body }));
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

if (catalog.length) {
  mkdirSync(join(DIST, 'library', 'catalog'), { recursive: true });
  for (const b of catalog) {
    const url = `${ORIGIN}/library/catalog/${b.id}`;
    const html = renderPage({
      url,
      title: `${b.title}${b.author ? ` (${b.author})` : ''} — читать на английском | DayEnglish`,
      desc: `Читать «${b.title}»${b.author ? ` (${b.author})` : ''} на английском с переводом слов и фраз, озвучкой и закладками. Уровень ${b.level}. Бесплатно, без регистрации.`,
      index: true,
      ldjson: bookLd(b, url),
      body: bookBody(b),
    });
    writeFileSync(join(DIST, 'library', 'catalog', `${b.id}.html`), html);
  }
}

// ── Sitemap: home + indexable flat routes + every grammar topic ────────────────────────────────────

/**
 * When the source behind a URL last changed, as a date.
 *
 * Was `new Date()` for all 83 URLs, so every deploy claimed every page had just changed — including the
 * ones untouched for weeks. A sitemap that cries wolf stops being a crawl signal at all.
 *
 * The last commit that touched the file, not its mtime: CI clones fresh, so mtime is checkout time and
 * would put today's date on everything again. Falls back to mtime, then to today, so a build outside a
 * git work tree still produces a valid sitemap.
 */
function sourceDate(file) {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      cwd: join(HERE, '..'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(out)) return out;
  } catch {
    // no git, or a shallow clone with no commit touching this file
  }
  try {
    return statSync(file).mtime.toISOString().slice(0, 10);
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

const SHELL_SRC = join(HERE, '..', 'index.html');
const SELF = fileURLToPath(import.meta.url);
// Flat pages and the home copy are authored here and in the shell, so the newer of the two is when
// their text last changed.
const flatDate = [sourceDate(SELF), sourceDate(SHELL_SRC)].sort().pop();
const grammarDate = sourceDate(GRAMMAR_JSON);
const catalogDate = sourceDate(CATALOG_JSON);

const urls = [
  { loc: `${ORIGIN}/`, lastmod: flatDate, priority: '1.0', changefreq: 'weekly' },
  ...ROUTES.filter((r) => r.index).map((r) => ({ loc: `${ORIGIN}/${r.key}`, lastmod: flatDate, priority: '0.8', changefreq: 'monthly' })),
  ...grammar.map((a) => ({ loc: `${ORIGIN}/grammar/${a.id}`, lastmod: grammarDate, priority: '0.7', changefreq: 'monthly' })),
  ...catalog.map((b) => ({ loc: `${ORIGIN}/library/catalog/${b.id}`, lastmod: catalogDate, priority: '0.6', changefreq: 'monthly' })),
];
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map((u) => `  <url>\n    <loc>${u.loc}</loc>\n    <lastmod>${u.lastmod}</lastmod>\n    <priority>${u.priority}</priority>\n    <changefreq>${u.changefreq}</changefreq>\n  </url>`)
  .join('\n')}
</urlset>
`;
writeFileSync(join(DIST, 'sitemap.xml'), sitemap);

console.log(
  `build-seo: wrote ${ROUTES.length} flat routes + ${grammar.length} grammar topics + ${catalog.length} catalog books + sitemap (${urls.length} urls, lastmod ${grammarDate} for topics, ${catalogDate} for books, ${flatDate} for the rest).`
);
