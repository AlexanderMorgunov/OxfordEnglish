import { Link } from 'react-router-dom';
import { Card, Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { SUPPORT_URL } from '@/features/support/config';
import {
  FEATURE_REQUEST_URL,
  BUG_REPORT_URL,
  SECURITY_REPORT_URL,
} from '@/features/community/config';

const linkClass =
  'inline-flex items-center justify-center gap-2 rounded-sm px-5 py-3 text-sm font-mono ' +
  'tracking-[0.02em] bg-teal text-ink font-semibold transition-[opacity,scale] duration-150 ' +
  'hover:opacity-90 active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal';

export function SupportPage() {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';

  return (
    <section aria-label={ru ? 'Поддержать проект' : 'Support the project'}>
      <Eyebrow className="mb-3.5">{ru ? 'поддержать' : 'support'}</Eyebrow>
      <h1 className="mb-4 text-2xl font-bold tracking-tight text-balance">
        {ru ? 'Поддержать проект' : 'Support the project'}
      </h1>

      <p className="mb-4 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Это приложение бесплатное и с открытым исходным кодом. Его делает один человек в свободное время — без рекламы, без подписок, без слежки.'
          : 'This app is free and open source. It is built by one person in their spare time — no ads, no subscriptions, no tracking.'}
      </p>
      <p className="mb-8 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Если оно помогает тебе учить английский, ты можешь поддержать разработку. Это добровольно и ничего не открывает — приложение и так полностью бесплатное. Спасибо, что помогаешь проекту жить.'
          : 'If it helps you learn English, you can support its development. It is voluntary and unlocks nothing — the app is already fully free. Thank you for helping the project keep going.'}
      </p>

      {SUPPORT_URL ? (
        <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" className={linkClass}>
          {ru ? 'Поддержать →' : 'Donate →'}
        </a>
      ) : (
        <Card className="border-amber-dim">
          <p className="font-mono text-2xs uppercase tracking-[0.08em] text-amber">
            {ru ? 'скоро' : 'coming soon'}
          </p>
          <p className="mt-2 text-sm text-muted">
            {ru
              ? 'Способ поддержки скоро появится. Загляни позже.'
              : 'A way to support the project is coming soon. Check back later.'}
          </p>
        </Card>
      )}

      <p className="mt-10 border-t border-line pt-5 text-xs leading-relaxed text-muted">
        {ru
          ? 'Донат — это добровольная поддержка автора, а не оплата товара или услуги. Он не даёт доступа к платным функциям и не подлежит возврату.'
          : 'A donation is voluntary support for the author, not a payment for goods or a service. It does not grant access to paid features and is non-refundable.'}
      </p>

      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'сообщество и обратная связь' : 'community & feedback'}
        </p>
        <p className="mb-4 text-sm text-muted text-pretty">
          {ru
            ? 'Всё открыто на GitHub. Обратная связь бесплатна и добровольна — ничего личного мы не собираем.'
            : "It's all open on GitHub. Feedback is free and voluntary — we collect nothing personal."}
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <a href={FEATURE_REQUEST_URL} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
            {ru ? '💡 Предложить фичу (голосование на GitHub) →' : '💡 Suggest a feature (vote on GitHub) →'}
          </a>
          <a href={BUG_REPORT_URL} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
            {ru ? '🐛 Сообщить о баге →' : '🐛 Report a bug →'}
          </a>
          <a href={SECURITY_REPORT_URL} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
            {ru ? '🔒 Сообщить об уязвимости (приватно) →' : '🔒 Report a vulnerability (private) →'}
          </a>
          <Link to="/credits" className="text-teal hover:underline">
            {ru ? '🙌 Благодарности и лицензии →' : '🙌 Credits & licenses →'}
          </Link>
        </div>
      </div>
    </section>
  );
}
