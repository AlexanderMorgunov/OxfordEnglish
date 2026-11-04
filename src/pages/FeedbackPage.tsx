import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { FeedbackForm } from '@/features/feedback/FeedbackForm';
import { FEEDBACK_EMAIL } from '@/features/feedback/config';
import { AppIcon } from '@/shared/ui/AppIcon';
import '@/features/feedback/feedback.css';

export function FeedbackPage() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    t = (rus: string, en: string) => (ru ? rus : en);
  return (
    <div className="fb-page">
      <nav
        className="fb-page-kicker"
        aria-label={t('Путь к странице', 'Breadcrumb')}
      >
        <Link to="/about">{t('О приложении', 'About')}</Link>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{t('Обратная связь', 'Feedback')}</span>
      </nav>
      <div className="fb-feedback-layout">
        <section className="fb-intro" aria-labelledby="feedback-title">
          <div className="fb-letter-mark">
            <AppIcon name="feedback" />
            <i>
              <AppIcon name="today" />
            </i>
          </div>
          <h1 id="feedback-title">
            {t(
              'Давайте сделаем DayEnglish лучше',
              'Let’s make DayEnglish better'
            )}
          </h1>
          <p className="fb-intro-lede">
            {t(
              'Заметили ошибку? Не хватает удобной функции? Расскажите — ваши идеи помогают приложению расти.',
              'Found a mistake? Missing a useful feature? Tell us: your ideas help the app grow.'
            )}
          </p>
          <p className="fb-no-account">
            <span aria-hidden="true">✓</span>
            {t(
              'Без аккаунта. Почта — по желанию.',
              'No account needed. Email is optional.'
            )}
          </p>
        </section>
        <FeedbackForm />
        <aside className="fb-writing-help" aria-labelledby="feedback-help">
          <h2 id="feedback-help">
            {t(
              'Чуть больше деталей — проще разобраться',
              'A little more detail makes it easier to help'
            )}
          </h2>
          <p>
            {t(
              'Если что-то пошло не так, попробуйте рассказать:',
              'If something went wrong, try to describe:'
            )}
          </p>
          <ul>
            <li>
              <span>{t('Где?', 'Where?')}</span>
              {t('В каком разделе или уроке.', 'Which section or lesson.')}
            </li>
            <li>
              <span>{t('Что сделали?', 'What did you do?')}</span>
              {t('На что нажали или что ввели.', 'What you tapped or typed.')}
            </li>
            <li>
              <span>{t('Что получилось?', 'What happened?')}</span>
              {t(
                'И чего ожидали вместо этого.',
                'And what you expected instead.'
              )}
            </li>
          </ul>
          <div className="fb-author-note">
            <AppIcon name="today" />
            <p>
              {t(
                'DayEnglish делает один человек. Ответить получается не всегда, но обратная связь помогает выбирать, что улучшать дальше.',
                'DayEnglish is made by one person. I cannot always reply, but your feedback helps decide what to improve next.'
              )}
            </p>
          </div>
        </aside>
      </div>
      <footer className="fb-feedback-footer">
        <Link to="/">
          <span aria-hidden="true">←</span>
          {t('Вернуться к учёбе', 'Back to studying')}
        </Link>
        <Link to="/privacy">{t('Конфиденциальность', 'Privacy')}</Link>
        {FEEDBACK_EMAIL && (
          <a href={`mailto:${FEEDBACK_EMAIL}`}>
            {t('Написать на почту', 'Email us')}
          </a>
        )}
      </footer>
    </div>
  );
}
