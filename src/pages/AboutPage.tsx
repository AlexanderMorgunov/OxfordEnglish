import { Fragment, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { track } from '@/features/analytics/analytics';
import { AboutDemo } from '@/features/landing/AboutDemo';
import { CommunitySection } from '@/features/community/CommunitySection';
import { AppIcon } from '@/shared/ui/AppIcon';
import type { AppIconName } from '@/shared/ui/AppIcon';
import '@/features/landing/about.css';
import '@/features/android-install/android-install.css';

function Cta({
  to,
  from,
  children,
  className = 'ab-feature-link',
}: {
  to: string;
  from: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Link
      to={to}
      className={className}
      onClick={() => {
        if (!to.startsWith('#')) void track('landing_cta', { to, from });
      }}
    >
      {children}
    </Link>
  );
}

export function AboutPage() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    t = (rus: string, eng: string) => (ru ? rus : eng);
  const root = useRef<HTMLDivElement>(null),
    location = useLocation();
  const previousHash = useRef(location.hash);
  useEffect(() => {
    const previous = previousHash.current;
    previousHash.current = location.hash;
    if (!location.hash) {
      if (previous)
        root.current?.querySelector('h1')?.focus({ preventScroll: true });
      return;
    }
    const id = location.hash.slice(1);
    const target = document.getElementById(id);
    if (target && root.current?.contains(target)) {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: 'start' });
    }
  }, [location.hash, location.key]);
  const faq = [
    [
      t('Нужно ли создавать аккаунт?', 'Do I need an account?'),
      t(
        'Нет. Курс, локальные книги, словарь и повторения можно использовать без аккаунта. Аккаунт нужен для возможностей, связанных с синхронизацией между устройствами.',
        'No. Use the course, local books, vocabulary and reviews without an account. An account is needed for cross-device sync features.'
      ),
    ],
    [
      t('С какого уровня можно начать?', 'Which level can I start from?'),
      t(
        'В курсе есть уровни A1, A2, B1 и B2. Если вы начинаете с нуля, подойдёт A1; стартовый тест поможет выбрать точку входа. Справочник и читалка доступны отдельно от маршрута.',
        'The course includes A1, A2, B1 and B2. Start at A1 if you are a beginner; the placement test can suggest a starting point. The reference and reader are also available separately.'
      ),
    ],
    [
      t('Что работает без интернета?', 'What works offline?'),
      t(
        'Заранее загруженные материалы, локальные книги и повторения доступны без сети. Для нового перевода через внешние сервисы, AI и синхронизации нужно соединение. Доступная озвучка зависит от голосов на устройстве.',
        'Previously downloaded materials, local books and reviews work offline. New external translations, AI requests and sync require a connection. Read-aloud availability depends on device voices.'
      ),
    ],
    [
      t('Книги куда-то отправляются?', 'Are my books uploaded?'),
      t(
        'Обычный импорт сохраняет книгу на устройстве. Если вы отдельно включите синхронизацию файлов книг, они загрузятся в облачное хранилище. Для перевода и AI выбранный текст может передаваться сервису обработки.',
        'Normal import keeps a book on your device. Enabling book-file sync uploads files to cloud storage. Selected text may be sent to a processing service for translation or AI.'
      ),
    ],
    [
      t('Нужна ли подписка для учёбы?', 'Do I need a subscription to study?'),
      t(
        'Основные учебные возможности бесплатны. Pro добавляет AI и возможности работы на нескольких устройствах. Текущие условия и доступность пробного периода указаны в разделе Pro.',
        'Core study features are free. Pro adds AI and cross-device features. Current terms and trial availability are shown in Pro.'
      ),
    ],
    [
      t(
        'Можно пользоваться с телефона и компьютера?',
        'Can I use a phone and a computer?'
      ),
      t(
        'Да, приложение работает в браузере; есть и Android-приложение. На телефоне сайт можно добавить на домашний экран. Локальный прогресс относится к конкретному устройству; синхронизация подключается отдельно.',
        'Yes. Use the browser or the Android app; the website can also be added to your phone’s home screen. Local progress belongs to each device, with sync available separately.'
      ),
    ],
  ];
  const quiet: {
    to: string;
    icon: AppIconName;
    title: string;
    text: string;
  }[] = [
    {
      to: '/grammar',
      icon: 'grammar',
      title: t('Грамматика под рукой', 'Grammar at hand'),
      text: t(
        'Объяснения на русском и примеры',
        'Clear explanations and examples'
      ),
    },
    {
      to: '/vocabulary',
      icon: 'vocabulary',
      title: t('Ваш личный словарь', 'Your own vocabulary'),
      text: t('Слова и фразы с контекстом', 'Words and phrases in context'),
    },
    {
      to: '/review',
      icon: 'review',
      title: t('Повторения по ответам', 'Reviews that follow your answers'),
      text: t(
        'Вернуться к тому, что запоминаете',
        'Return to what you are learning'
      ),
    },
  ];
  return (
    <div className="ab-page" ref={root} id="about-top" tabIndex={-1}>
      <div className="ab-about-heading">
        <p>{t('О DayEnglish', 'About DayEnglish')}</p>
        <nav aria-label={t('На этой странице', 'On this page')}>
          <Link to="#features">{t('Возможности', 'Features')}</Link>
          <Link to="#access">{t('Бесплатно и Pro', 'Free and Pro')}</Link>
          <Link to="#faq">{t('Вопросы', 'Questions')}</Link>
          <Link to="#community">{t('Соцсети', 'Community')}</Link>
        </nav>
      </div>
      <section className="ab-hero" aria-labelledby="about-hero-title">
        <div className="ab-hero-copy">
          <div className="ab-day-mark">
            <AppIcon name="today" />
          </div>
          <h1 id="about-hero-title" tabIndex={-1}>
            {t('Учите английский. Читайте в оригинале.', 'Learn English. Read books in English.')}
          </h1>
          <p className="ab-hero-lede">
            {t(
              'Понятный маршрут учёбы, книги в оригинале и слова, которые хочется запомнить. Всё рядом, в вашем темпе.',
              'A clear learning path, books in English and words you want to remember. All together, at your own pace.'
            )}
          </p>
          <div className="ab-hero-actions">
            <Cta to="/" from="hero" className="ab-btn ab-primary">
              {t('Открыть учебный путь', 'Open the learning path')} →
            </Cta>
            <Link className="ab-try-link" to="#live-demo">
              {t('Попробовать на примере', 'Try an example')}
            </Link>
          </div>
          <p className="ab-hero-note">
            {t(
              'Курс A1–B2. Можно начать без аккаунта.',
              'A1–B2 course. Start without an account.'
            )}
          </p>
        </div>
        <AboutDemo />
      </section>
      <section
        id="features"
        tabIndex={-1}
        className="ab-feature-section ab-section-space"
        aria-labelledby="about-features-title"
      >
        <div className="ab-section-heading">
          <h2 id="about-features-title">
            {t(
              'От первого правила до своей книги',
              'From your first rule to your own book'
            )}
          </h2>
          <p>
            {t(
              'Учитесь по маршруту — и встречайте знакомое в том, что вам интересно.',
              'Follow a learning path and meet familiar English in things you enjoy.'
            )}
          </p>
        </div>
        <div className="ab-feature-layout">
          <article className="ab-course-feature">
            <div className="ab-feature-icon">
              <AppIcon name="today" />
            </div>
            <h3>
              {t(
                'Не нужно решать, что учить сегодня',
                'No need to decide what to study today'
              )}
            </h3>
            <p>
              {t(
                'В учебном пути уже собраны слова, грамматика, чтение и аудирование. Возвращайтесь к следующему шагу, когда удобно.',
                'Vocabulary, grammar, reading and listening are already arranged along your path. Come back to the next step when it suits you.'
              )}
            </p>
            <div
              className="ab-level-track"
              aria-label={t('Уровни курса', 'Course levels')}
            >
              {['A1', 'A2', 'B1', 'B2'].map((level, index) => (
                <Fragment key={level}>
                  {index > 0 && <i aria-hidden="true" />}
                  <span>{level}</span>
                </Fragment>
              ))}
            </div>
            <Cta to="/" from="course">
              {t('Посмотреть учебный путь', 'Explore the learning path')} →
            </Cta>
          </article>
          <article className="ab-reading-feature">
            <div className="ab-feature-icon">
              <AppIcon name="library" />
            </div>
            <h3>{t('Читайте то, что нравится вам', 'Read what you enjoy')}</h3>
            <p>
              {t(
                'Выберите книгу в библиотеке или добавьте свою: EPUB, FB2, DOCX или PDF. Значение слова можно посмотреть прямо в тексте.',
                'Choose a library book or import your own EPUB, FB2, DOCX or PDF. Look up words directly in the text.'
              )}
            </p>
            <Cta to="/library" from="reader">
              {t('Выбрать книгу', 'Choose a book')} →
            </Cta>
            <div className="ab-book-lines" aria-hidden="true">
              <span />
              <span />
              <span />
              <b>
                A good book.
                <br />A new word.
                <br />A small step.
              </b>
            </div>
          </article>
        </div>
        <div className="ab-quiet-features">
          {quiet.map((item) => (
            <Cta to={item.to} from="features" key={item.to}>
              <AppIcon name={item.icon} />
              <span>
                <strong>{item.title}</strong>
                <small>{item.text}</small>
              </span>
              <span aria-hidden="true">→</span>
            </Cta>
          ))}
        </div>
      </section>
      <section
        className="ab-connection ab-section-space"
        aria-labelledby="about-connection-title"
      >
        <div>
          <h2 id="about-connection-title">
            {t(
              'Встреченное в книге остаётся с вами',
              'Keep what you encounter in books'
            )}
          </h2>
          <p>
            {t(
              'Посмотрите значение. Сохраните нужное слово или фразу. Затем вернитесь к ним в повторениях — вместе с контекстом.',
              'Check the meaning. Save a word or phrase you need. Return to it in reviews, together with its context.'
            )}
          </p>
          <Link className="ab-try-link" to="#live-demo">
            {t(
              'Пройти этот путь на примере',
              'Try this journey in the example'
            )}
          </Link>
        </div>
        <ol className="ab-connection-steps">
          {[
            [
              t('Прочитали', 'Read'),
              t(
                'Значение рядом с исходным текстом',
                'Meaning beside the original text'
              ),
            ],
            [
              t('Сохранили', 'Save'),
              t(
                'Добавили именно то, что хотите учить',
                'Keep what you want to learn'
              ),
            ],
            [
              t('Вспомнили', 'Recall'),
              t(
                'Открыли ответ и оценили себя',
                'Reveal the answer and rate your recall'
              ),
            ],
          ].map(([title, text], index) => (
            <li key={index}>
              <span>{index + 1}</span>
              <div>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
      <section
        id="access"
        tabIndex={-1}
        className="ab-access-section ab-section-space"
        aria-labelledby="about-access-title"
      >
        <div className="ab-section-heading">
          <h2 id="about-access-title">
            {t(
              'Начните с того, что уже доступно',
              'Start with what is already available'
            )}
          </h2>
          <p>
            {t(
              'Основное для учёбы — бесплатно. Дополнительные возможности можно подключить отдельно.',
              'Core study features are free. Add extra capabilities when you need them.'
            )}
          </p>
        </div>
        <div className="ab-access-grid">
          <article className="ab-access-free">
            <p className="ab-access-label">{t('Бесплатно', 'Free')}</p>
            <h3>{t('Для английского каждый день', 'For everyday English')}</h3>
            <ul>
              {[
                t(
                  'Учебный курс и справочник грамматики',
                  'The course and grammar reference'
                ),
                t('Читалка и локальные книги', 'Reader and local books'),
                t(
                  'Личный словарь и повторения',
                  'Personal vocabulary and reviews'
                ),
                t('Прогресс на вашем устройстве', 'Progress on your device'),
              ].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <Cta to="/" from="free" className="ab-btn ab-primary">
              {t('Перейти к учёбе', 'Start learning')}
            </Cta>
          </article>
          <article className="ab-access-pro">
            <p className="ab-access-label">
              {t('DayEnglish Pro · по желанию', 'DayEnglish Pro · optional')}
            </p>
            <h3>
              {t(
                'Когда нужна дополнительная помощь',
                'When you need some extra help'
              )}
            </h3>
            <ul>
              {[
                t('Объяснения и разборы с AI', 'AI explanations and feedback'),
                t(
                  'Перевод с учётом контекста',
                  'Translation that considers context'
                ),
                t(
                  'Продолжение на другом устройстве',
                  'Continue on another device'
                ),
              ].map((text) => (
                <li key={text}>{text}</li>
              ))}
            </ul>
            <p className="ab-access-caption">
              {t(
                'Актуальные условия и доступ к пробному периоду — в разделе Pro. Для части AI-функций можно использовать свой API-ключ в настройках.',
                'See Pro for current terms and trial availability. Some AI features also support your own API key in Settings.'
              )}
            </p>
            <Cta to="/pro" from="pro">
              {t('Узнать о Pro', 'Explore Pro')} →
            </Cta>
          </article>
        </div>
      </section>
      <section
        className="ab-data-section ab-section-space"
        aria-labelledby="about-data-title"
      >
        <div className="ab-data-symbol">
          <AppIcon name="settings" />
        </div>
        <div>
          <h2 id="about-data-title">
            {t('Начать можно на своём устройстве', 'Start on your own device')}
          </h2>
          <p>
            {t(
              'Книги и учебные данные сохраняются локально. Аккаунт и синхронизация подключаются отдельно; если включить облачное хранение книг, их файлы загрузятся в облако.',
              'Books and learning data are stored locally. Account and sync features are optional; enabling book-file sync uploads files to the cloud.'
            )}
          </p>
          <div className="ab-data-links">
            <Cta to="/settings/data" from="data">
              {t('Управление данными в настройках', 'Manage data in Settings')}
            </Cta>
            <Cta to="/privacy" from="privacy">
              {t('Конфиденциальность', 'Privacy')}
            </Cta>
          </div>
        </div>
      </section>
      <section
        id="faq"
        tabIndex={-1}
        className="ab-faq-section ab-section-space"
        aria-labelledby="about-faq-title"
      >
        <div className="ab-section-heading">
          <h2 id="about-faq-title">
            {t('Остались вопросы?', 'Any questions?')}
          </h2>
          <p>
            {t(
              'Коротко о том, как начать и что понадобится.',
              'A quick guide to getting started and what you need.'
            )}
          </p>
        </div>
        <div className="ab-faq-list">
          {faq.map(([question, answer], index) => (
            <details key={index}>
              <summary>{question}</summary>
              <p>{answer}</p>
            </details>
          ))}
        </div>
      </section>
      <aside className="android-about-link">
        <AppIcon name="phone" />
        <p>{t('DayEnglish есть и для Android.', 'DayEnglish is also available for Android.')}</p>
        <Link to="/android">{t('Об установке из RuStore', 'Installing from RuStore')} →</Link>
      </aside>
      <CommunitySection key={location.key} />
      <section
        className="ab-project-section ab-section-space"
        aria-labelledby="about-project-title"
      >
        <div>
          <h2 id="about-project-title">
            {t(
              'DayEnglish становится лучше вместе с вами',
              'Help DayEnglish get better'
            )}
          </h2>
          <p>
            {t(
              'Нашли ошибку в задании или придумали, как сделать учёбу удобнее? Расскажите об этом через обратную связь.',
              'Found a mistake in an exercise or have an idea for better learning? Tell us through Feedback.'
            )}
          </p>
        </div>
        <Cta to="/feedback" from="feedback" className="ab-btn">
          {t('Обратная связь', 'Feedback')} →
        </Cta>
      </section>
      <section
        className="ab-closing ab-section-space"
        aria-labelledby="about-closing-title"
      >
        <div className="ab-closing-mark">
          <AppIcon name="today" />
        </div>
        <h2 id="about-closing-title">
          {t(
            'Продолжим с одного небольшого шага?',
            'Shall we take one small step?'
          )}
        </h2>
        <p>
          {t(
            'Откройте учебный путь или выберите книгу. Остальное найдётся по дороге.',
            'Open the learning path or choose a book. Discover the rest along the way.'
          )}
        </p>
        <div className="ab-closing-actions">
          <Cta to="/" from="footer" className="ab-btn ab-primary">
            {t('К учебному пути', 'Open the learning path')} →
          </Cta>
          <Cta to="/library" from="footer" className="ab-try-link">
            {t('Открыть библиотеку', 'Open the library')}
          </Cta>
        </div>
      </section>
      <nav
        className="ab-about-footer"
        aria-label={t('Информация о приложении', 'App information')}
      >
        <Link className="ab-feature-link" to="#about-top">
          {t('К началу страницы', 'Back to top')} ↑
        </Link>
        <Cta to="/support" from="support">
          {t('Поддержать проект', 'Support the project')}
        </Cta>
        <Cta to="/credits" from="credits">
          {t('Благодарности и лицензии', 'Credits and licences')}
        </Cta>
        <Cta to="/privacy" from="privacy">
          {t('Конфиденциальность', 'Privacy')}
        </Cta>
        <Cta to="/terms" from="terms">
          {t('Условия использования', 'Terms of use')}
        </Cta>
      </nav>
    </div>
  );
}
