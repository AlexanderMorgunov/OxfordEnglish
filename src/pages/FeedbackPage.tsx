import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { FeedbackForm } from '@/features/feedback/FeedbackForm';
import { FEEDBACK_EMAIL } from '@/features/feedback/config';

export function FeedbackPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';

  return (
    <section aria-label={ru ? 'Обратная связь' : 'Feedback'} className="max-w-prose">
      <Eyebrow className="mb-3.5">{ru ? 'обратная связь' : 'feedback'}</Eyebrow>
      <h1 className="mb-3 text-2xl font-bold tracking-tight text-balance">
        {ru ? 'Нашли проблему или есть идея?' : 'Found a problem or have an idea?'}
      </h1>
      <p className="mb-8 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Расскажите про ошибку в уроке, что-то сломалось или что хочется добавить. Не нужен аккаунт, ничего личного не собираем.'
          : "Tell us about a mistake in a lesson, something that broke, or what you'd like added. No account needed, nothing personal collected."}
      </p>

      <FeedbackForm />

      {FEEDBACK_EMAIL && (
        <p className="mt-8 border-t border-line pt-5 text-xs leading-relaxed text-muted">
          {ru ? 'Или напишите напрямую: ' : 'Or email directly: '}
          <a href={`mailto:${FEEDBACK_EMAIL}`} className="text-teal hover:underline">
            {FEEDBACK_EMAIL}
          </a>
        </p>
      )}
    </section>
  );
}
