import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { track } from '@/features/analytics/analytics';
import { useReveal } from '@/features/landing/reveal';
import { WordTapDemo } from '@/features/landing/WordTapDemo';
import { ReviewDemo } from '@/features/landing/ReviewDemo';

function Cta({
  to,
  from,
  children,
  primary,
}: {
  to: string;
  /** Which block the click came from — the landing's only conversion signal. */
  from: string;
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <Link
      to={to}
      onClick={() => void track('landing_cta', { to, from })}
      className={
        primary
          ? 'inline-flex items-center gap-2 rounded-sm bg-teal px-5 py-3 font-mono text-sm font-semibold text-ink transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal'
          : 'inline-flex items-center gap-2 rounded-sm border border-line px-5 py-3 font-mono text-sm text-content transition-colors hover:border-teal-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal'
      }
    >
      {children}
    </Link>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section data-reveal className="mt-14">
      <h2 className="mb-4 text-xl font-bold tracking-tight text-balance">{title}</h2>
      {children}
    </section>
  );
}

export function AboutPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (rus: string, eng: string) => (ru ? rus : eng);
  const root = useReveal<HTMLDivElement>();

  const steps = [
    {
      n: '1',
      title: t('Короткий тест уровня', 'A short placement test'),
      text: t(
        'Пять минут — и понятно, с какого дня начинать: от полного нуля (A1) до уверенного B1.',
        'Five minutes and you know where to start: from zero (A1) to confident B1.'
      ),
    },
    {
      n: '2',
      title: t('Учебный день по 15 минут', 'A 15-minute learning day'),
      text: t(
        'Новые слова, грамматика, чтение и аудирование — одним маршрутом, без выбора «что бы поучить».',
        'New words, grammar, reading and listening in one route — no “what should I study today”.'
      ),
    },
    {
      n: '3',
      title: t('Своя книга в читалке', 'Your own book in the reader'),
      text: t(
        'Читаете то, что интересно вам. Слова из книги попадают в повторения и возвращаются вовремя.',
        'Read what you actually like. Words from the book go into review and come back on time.'
      ),
    },
  ];

  const features = [
    {
      icon: '/assets/pixel/nav/today.png',
      title: t('Курс A1 → B2', 'A1 → B2 course'),
      text: t(
        'Готовые учебные дни с упражнениями девяти типов и контрольными в конце юнитов.',
        'Ready learning days with nine exercise types and unit checkpoints.'
      ),
    },
    {
      icon: '/assets/pixel/nav/grammar.png',
      title: t('Справочник грамматики', 'Grammar reference'),
      text: t(
        'Десятки тем с объяснениями на русском, примерами и разбором частых ошибок.',
        'Dozens of topics explained in plain language, with examples and common mistakes.'
      ),
    },
    {
      icon: '/assets/pixel/nav/library.png',
      title: t('Читалка книг', 'Book reader'),
      text: t(
        'EPUB, FB2, DOCX и PDF плюс встроенная библиотека. Перевод по клику, озвучка, закладки.',
        'EPUB, FB2, DOCX and PDF plus a built-in library. Tap-to-translate, read-aloud, bookmarks.'
      ),
    },
    {
      icon: '/assets/pixel/nav/review.png',
      title: t('Интервальные повторения', 'Spaced repetition'),
      text: t(
        'Алгоритм FSRS — тот же, что в современных Anki-сборках: слово возвращается перед тем, как забудется.',
        'The FSRS algorithm: a word returns right before you would forget it.'
      ),
    },
    {
      icon: '/assets/pixel/nav/vocab.png',
      title: t('Словарь с уровнями', 'Vocabulary with levels'),
      text: t(
        'У каждого слова уровень по шкале CEFR и формы неправильных глаголов: go — went — gone.',
        'Every word carries a CEFR level and irregular forms: go — went — gone.'
      ),
    },
    {
      icon: '/assets/pixel/nav/progress.png',
      title: t('Честная статистика', 'Honest statistics'),
      text: t(
        'Время чтения считается только когда вы действительно читаете, а не когда вкладка висит открытой.',
        'Reading time counts only while you actually read — not while a tab sits open.'
      ),
    },
    {
      icon: '/assets/pixel/sections/listening.png',
      title: t('Аудирование и озвучка', 'Listening and read-aloud'),
      text: t(
        'Диктанты, разбор на слух и чтение вслух любого абзаца книги.',
        'Dictation, listening practice and read-aloud for any paragraph.'
      ),
    },
    {
      icon: '/assets/pixel/ui/ai.png',
      title: t('ИИ на вашем ключе', 'AI on your own key'),
      text: t(
        'Подсказки, объяснение ошибок и смысл слова в контексте — по желанию, на вашем ключе. Ключ не покидает браузер.',
        'Hints, “why is this wrong?” and in-context meaning — optional, on your key. The key never leaves your browser.'
      ),
    },
  ];

  const faq = [
    {
      q: t('Сколько это стоит?', 'How much does it cost?'),
      a: t(
        'Нисколько. Нет рекламы, платных уровней и подписки: проект сделан как открытый исходный код.',
        'Nothing. No ads, no paid tiers, no subscription — the project is open source.'
      ),
    },
    {
      q: t('Нужна ли регистрация?', 'Do I need an account?'),
      a: t(
        'Нет. Прогресс хранится в вашем браузере, его можно выгрузить файлом и перенести на другое устройство.',
        'No. Progress lives in your browser and can be exported to a file and moved to another device.'
      ),
    },
    {
      q: t('Работает ли без интернета?', 'Does it work offline?'),
      a: t(
        'Да. После первой загрузки уроки, повторения и книги открываются без сети.',
        'Yes. After the first load, lessons, reviews and books open without a connection.'
      ),
    },
    {
      q: t('Мои книги куда-то загружаются?', 'Are my books uploaded anywhere?'),
      a: t(
        'Нет. Импортированные книги остаются в хранилище браузера на вашем устройстве и никуда не отправляются.',
        'No. Imported books stay in your browser storage on your device and are never sent anywhere.'
      ),
    },
    {
      q: t('С какого уровня можно начать?', 'Which level can I start from?'),
      a: t(
        'С нуля. Есть тир A1 для начинающих, дальше A2, B1 и B2 — тест в начале подскажет точку старта.',
        'From zero. There is an A1 tier for beginners, then A2, B1 and B2 — the placement test finds your start.'
      ),
    },
    {
      q: t('Это приложение или сайт?', 'Is it an app or a website?'),
      a: t(
        'И то и другое: открывается в браузере и ставится на домашний экран как обычное приложение.',
        'Both: it opens in the browser and installs to your home screen like a normal app.'
      ),
    },
  ];

  return (
    <div ref={root}>
      <section data-reveal>
        <p className="eyebrow mb-3.5">{t('что это', 'what this is')}</p>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="mb-3 text-3xl font-bold tracking-tight text-balance">
              {t('Английский по одному дню за раз', 'English, one day at a time')}
            </h1>
            <p className="max-w-prose text-lg text-muted text-pretty">
              {t(
                'Бесплатный курс от A1 до B2 и читалка книг в одном приложении: слова, которые встретились вам в тексте, сами попадают в повторения и возвращаются, пока не запомнятся.',
                'A free A1 → B2 course and a book reader in one app: words you meet in a text go into spaced repetition and keep coming back until they stick.'
              )}
            </p>
          </div>
          <PixelImage
            src="/assets/pixel/mascot.png"
            alt=""
            width={96}
            height={96}
            className="hidden h-24 w-24 shrink-0 sm:block"
          />
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Cta to="/" from="hero" primary>
            {t('Начать бесплатно →', 'Start for free →')}
          </Cta>
          <Cta to="/library" from="hero">
            {t('Полистать библиотеку', 'Browse the library')}
          </Cta>
        </div>
        <p className="mt-4 flex flex-wrap gap-x-4 gap-y-1 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
          <span>{t('бесплатно', 'free')}</span>
          <span>{t('без регистрации', 'no account')}</span>
          <span>{t('работает офлайн', 'works offline')}</span>
          <span>{t('без рекламы', 'no ads')}</span>
        </p>
      </section>

      <Section title={t('Как это работает', 'How it works')}>
        <ol className="flex flex-col gap-3">
          {steps.map((s) => (
            <li key={s.n} className="flex gap-3.5 rounded-md border border-line bg-surface px-4 py-3.5">
              <span aria-hidden className="font-mono text-lg text-teal">
                {s.n}
              </span>
              <span>
                <span className="block text-base text-content">{s.title}</span>
                <span className="mt-0.5 block text-sm text-muted text-pretty">{s.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </Section>

      <Section title={t('Слово из книги — в один тап', 'A word from a book in one tap')}>
        <p className="mb-4 max-w-prose text-base text-muted text-pretty">
          {t(
            'В читалке не нужно выходить в словарь: нажмите слово — и увидите перевод, насколько оно частотное по шкале CEFR и формы, если глагол неправильный. Попробуйте прямо здесь.',
            'In the reader you never leave for a dictionary: tap a word to see its translation, how common it is on the CEFR scale, and its forms if the verb is irregular. Try it right here.'
          )}
        </p>
        <WordTapDemo />
      </Section>

      <Section title={t('Слова возвращаются вовремя', 'Words come back on time')}>
        <p className="mb-4 max-w-prose text-base text-muted text-pretty">
          {t(
            'Сохранённое слово попадает в очередь повторений. Интервал подбирается по вашим ответам: то, что даётся тяжело, возвращается чаще.',
            'A saved word joins the review queue. The interval follows your answers: what is hard comes back more often.'
          )}
        </p>
        <ReviewDemo />
      </Section>

      <Section title={t('Что внутри', 'What is inside')}>
        <div className="grid gap-2.5 sm:grid-cols-2">
          {features.map((f) => (
            <div key={f.title} className="rounded-md border border-line bg-surface px-4 py-3.5">
              <p className="flex items-center gap-2.5 text-base text-content">
                <PixelImage src={f.icon} alt="" width={20} height={20} className="h-5 w-5 shrink-0" />
                {f.title}
              </p>
              <p className="mt-1 text-sm text-muted text-pretty">{f.text}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section title={t('Ваши данные остаются вашими', 'Your data stays yours')}>
        <ul className="flex flex-col gap-2 text-base text-pretty">
          <li>
            {t(
              'Прогресс, словарь и книги хранятся в браузере на вашем устройстве.',
              'Progress, vocabulary and books are stored in your browser, on your device.'
            )}
          </li>
          <li>{t('Аккаунт не нужен — значит, и терять нечего.', 'No account is needed — so there is nothing to lose.')}</li>
          <li>
            {t(
              'Анонимную статистику можно выключить одной галочкой в настройках.',
              'Anonymous usage stats can be switched off with one checkbox in settings.'
            )}
          </li>
          <li>
            {t(
              'Прогресс выгружается в файл и переносится на другое устройство.',
              'Progress exports to a file and moves to another device.'
            )}
          </li>
        </ul>
      </Section>

      <Section title={t('Частые вопросы', 'Frequently asked questions')}>
        <div className="flex flex-col gap-2">
          {faq.map((item) => (
            <details key={item.q} className="rounded-md border border-line bg-surface px-4 py-3">
              <summary className="cursor-pointer text-base text-content marker:text-teal">{item.q}</summary>
              <p className="mt-2 text-sm text-muted text-pretty">{item.a}</p>
            </details>
          ))}
        </div>
      </Section>

      <section data-reveal className="mt-14 rounded-lg border border-teal-dim bg-teal-dim/10 px-5 py-6 text-center">
        <h2 className="mb-2 text-xl font-bold tracking-tight text-balance">
          {t('Начните с сегодняшнего дня', 'Start with today')}
        </h2>
        <p className="mx-auto mb-5 max-w-prose text-base text-muted text-pretty">
          {t(
            'Ничего не нужно устанавливать: приложение откроется в браузере, а потом его можно добавить на домашний экран.',
            'Nothing to install: the app opens in your browser, and you can add it to your home screen afterwards.'
          )}
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Cta to="/" from="footer" primary>
            {t('Открыть приложение →', 'Open the app →')}
          </Cta>
          <Cta to="/grammar" from="footer">
            {t('Справочник грамматики', 'Grammar reference')}
          </Cta>
        </div>
      </section>
    </div>
  );
}
