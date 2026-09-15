import { Link } from 'react-router-dom';
import { Card, Eyebrow, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { SUPPORT_URL } from '@/features/support/config';
import { SECURITY_EMAIL } from '@/features/community/config';

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
      <div className="mb-4 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/support.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          {ru ? 'Поддержать проект' : 'Support the project'}
        </h1>
      </div>

      <p className="mb-4 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Это приложение бесплатное и с открытым исходным кодом. Его делает один человек в свободное время — без рекламы и без слежки.'
          : 'This app is free and open source. It is built by one person in their spare time — no ads, no tracking.'}
      </p>
      <p className="mb-8 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Если оно помогает тебе учить английский, ты можешь поддержать разработку. Это добровольно и ничего не открывает — в том числе подписку Pro. Учебная часть приложения и так полностью бесплатна. Спасибо, что помогаешь проекту жить.'
          : 'If it helps you learn English, you can support its development. It is voluntary and unlocks nothing — the Pro subscription included. The learning side of the app is free anyway. Thank you for helping the project keep going.'}
      </p>
      <p className="mb-8 text-base leading-relaxed text-pretty text-muted">
        {ru ? (
          <>
            Есть и второй способ: подписка{' '}
            <Link to="/pro" className="text-teal hover:underline">
              DayEnglish Pro
            </Link>{' '}
            — она даёт синхронизацию между устройствами и ИИ-разборы, и заодно оплачивает серверы, на
            которых держится бесплатная часть.
          </>
        ) : (
          <>
            There is a second way: the{' '}
            <Link to="/pro" className="text-teal hover:underline">
              DayEnglish Pro
            </Link>{' '}
            subscription — it gives you cross-device sync and the AI explanations, and it pays for the
            servers the free side runs on.
          </>
        )}
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
          {ru ? 'обратная связь' : 'feedback'}
        </p>
        <p className="mb-3 text-sm text-muted text-pretty">
          {ru
            ? 'Нашли ошибку в уроке, что-то сломалось или есть идея? Напишите прямо в приложении — без аккаунта, ничего личного не собираем.'
            : 'Found a lesson mistake, something broken, or have an idea? Tell us right in the app — no account, nothing personal collected.'}
        </p>
        <div className="flex flex-col gap-2 text-sm">
          <Link to="/feedback" className="text-teal hover:underline">
            {ru ? '💬 Написать нам →' : '💬 Send feedback →'}
          </Link>
          <Link to="/credits" className="text-teal hover:underline">
            {ru ? '🙌 Благодарности и лицензии →' : '🙌 Credits & licenses →'}
          </Link>
        </div>
      </div>

      {/* No issue tracker or discussions link here on purpose. Inviting contributions we do not intend
          to service is a promise, and an unanswered issue sitting at the top of the repo tells a
          prospective user the project is abandoned — worse than no link at all. Feedback has its own
          in-app form (no account, nothing personal), which is linked above. */}
      <div className="mt-10 border-t border-line pt-8">
        <p className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'безопасность' : 'security'}
        </p>
        <p className="mb-3 text-sm text-muted text-pretty">
          {ru
            ? 'Нашли уязвимость? Напишите на почту — пожалуйста, не публикуйте её до ответа. Это учебное приложение, но в нём есть аккаунты и оплата, так что сообщения такого рода читаются в первую очередь.'
            : 'Found a vulnerability? Email it — please do not publish it before we reply. This is a learning app, but it has accounts and payments, so reports like this are read first.'}
        </p>
        {SECURITY_EMAIL && (
          <a href={`mailto:${SECURITY_EMAIL}?subject=${encodeURIComponent('DayEnglish security')}`} className="text-sm text-teal hover:underline">
            🔒 {SECURITY_EMAIL}
          </a>
        )}
      </div>
    </section>
  );
}
