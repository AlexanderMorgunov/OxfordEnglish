import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { accountsEnabled } from '@/features/account/config';
import { billingPlans } from '@/features/account/api';
import { formatPrice } from '@/features/account/billing';
import { track } from '@/features/analytics/analytics';
import { BackToReader } from '@/features/reader/BackToReader';
import type { BillingPlan } from '@/features/account/contract';

/**
 * `/pro` — the one public explanation of the paid plan, reachable WITHOUT an account.
 *
 * Order of the blocks is the argument, not decoration: what is free comes first, then the free
 * bring-your-own-key path, and only then Pro. The plan is a convenience — it is not the only way to
 * the AI features and must never be presented as one.
 *
 * The price is never hardcoded; it comes from the server (`/v1/billing/plans`), the same source
 * `PlanSection` reads. When billing is switched off the page still explains the product and says so
 * plainly instead of advertising a purchase that cannot be made.
 */

const FREE_RU = [
  'Курс от A1 до B2 — учебные дни с упражнениями, грамматикой, чтением и аудированием',
  'Читалка: свои книги (EPUB, FB2, DOCX, PDF) и встроенный каталог, перевод слов по клику',
  'Интервальные повторения по алгоритму FSRS и личный словарь',
  'Справочник грамматики с объяснениями на русском',
  'Всё работает офлайн и без регистрации',
];
const FREE_EN = [
  'The A1 → B2 course — learning days with exercises, grammar, reading and listening',
  'The reader: your own books (EPUB, FB2, DOCX, PDF) and a built-in catalog, tap-to-translate',
  'Spaced repetition on the FSRS algorithm, and a personal vocabulary',
  'A grammar reference explained in plain language',
  'All of it offline, with no account needed',
];

const ACCOUNT_RU = [
  'Прогресс, словарь, закладки и позиции чтения на всех ваших устройствах',
  'Резервная копия в облаке — устройство можно потерять, прогресс нет',
  'Синхронизация файлов загруженных книг',
];
const ACCOUNT_EN = [
  'Progress, vocabulary, bookmarks and reading positions on all your devices',
  'A cloud backup — you can lose a device without losing your progress',
  'Syncing of imported book files',
];

const AI_RU = [
  'Разбор грамматики предложения',
  'Упрощение текста до вашего уровня',
  'Перевод слова с учётом контекста предложения',
];
const AI_EN = [
  'A grammar explanation of a sentence',
  'Simplification of a text to your level',
  'Word translation that accounts for the sentence around it',
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="mb-2 text-lg font-bold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-pretty text-muted">{children}</div>
    </section>
  );
}

const Bullets = ({ items }: { items: string[] }) => (
  <ul className="list-disc space-y-1 pl-5">
    {items.map((i) => (
      <li key={i}>{i}</li>
    ))}
  </ul>
);

export function ProPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [plans, setPlans] = useState<{ available: boolean; plans: BillingPlan[] } | null>(null);

  useEffect(() => {
    void track('pro_page_view');
    if (!accountsEnabled()) {
      setPlans({ available: false, plans: [] });
      return;
    }
    let alive = true;
    billingPlans()
      .then((p) => alive && setPlans(p))
      // Offline or the API is down: the page still explains everything, it just cannot quote a price.
      .catch(() => alive && setPlans({ available: false, plans: [] }));
    return () => {
      alive = false;
    };
  }, []);

  const monthly = plans?.plans.find((p) => p.code === 'pro_month');
  const canBuy = !!plans?.available && !!monthly;
  const price = monthly ? formatPrice(monthly.priceKopecks) : null;

  return (
    <article className="max-w-prose">
      <BackToReader />
      <Eyebrow className="mb-3.5">{ru ? 'подписка' : 'subscription'}</Eyebrow>
      <h1 className="text-2xl font-bold tracking-tight text-balance">
        {ru ? 'DayEnglish Pro' : 'DayEnglish Pro'}
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
        {ru
          ? 'Коротко: учиться в DayEnglish можно бесплатно и без аккаунта — это не урезанная версия. Pro нужен, если вы занимаетесь на нескольких устройствах или хотите разборы на основе ИИ без возни со своим ключом.'
          : 'In short: learning with DayEnglish is free and needs no account — this is not a stripped-down version. Pro is for studying on more than one device, or for getting the AI explanations without setting up a key of your own.'}
      </p>

      <Section title={ru ? 'Что бесплатно всегда' : 'What is always free'}>
        <Bullets items={ru ? FREE_RU : FREE_EN} />
        <p>
          {ru
            ? 'Ничего из этого не станет платным. Бесплатный доступ к учёбе — смысл проекта, а не приманка.'
            : 'None of this will become paid. Free access to the learning is the point of the project, not bait.'}
        </p>
      </Section>

      <Section title={ru ? 'Что добавляет Pro' : 'What Pro adds'}>
        <p className="text-content">{ru ? 'Две вещи.' : 'Two things.'}</p>
        <p>
          <b className="text-content">{ru ? '1. Несколько устройств.' : '1. More than one device.'}</b>{' '}
          {ru
            ? 'Прогресс, словарь, закладки и позиции чтения переносятся между устройствами, а в облаке лежит резервная копия. Сюда же — файлы загруженных книг.'
            : 'Progress, vocabulary, bookmarks and reading positions move between your devices, with a backup in the cloud. Imported book files too.'}
        </p>
        <Bullets items={ru ? ACCOUNT_RU : ACCOUNT_EN} />
        <p>
          <b className="text-content">{ru ? '2. Разборы на основе ИИ.' : '2. The AI explanations.'}</b>{' '}
          {ru ? 'Ровно три:' : 'Exactly three:'}
        </p>
        <Bullets items={ru ? AI_RU : AI_EN} />
        <p>
          {ru
            ? 'К разборам есть и бесплатный путь — свой ключ ИИ. К синхронизации его нет: она работает на нашем сервере и нашем хранилище.'
            : 'The explanations also have a free path — your own AI key. Syncing does not: it runs on our server and our storage.'}
        </p>
      </Section>

      <Section title={ru ? 'Разборы можно получить и бесплатно — своим ключом' : 'The explanations are also free with your own key'}>
        <p>
          {ru
            ? 'Добавьте ключ любого совместимого провайдера в настройках — и разборы работают без всякой подписки, сколько угодно. Запросы идут из вашего браузера напрямую к провайдеру, мимо нашего сервера, а ключ хранится только на устройстве.'
            : 'Add a key from any compatible provider in settings and the explanations work with no subscription at all, as much as you like. Requests go straight from your browser to the provider, bypassing our server, and the key never leaves your device.'}
        </p>
        <p>
          <Link to="/settings" className="text-teal hover:underline">
            {ru ? 'Добавить свой ключ в настройках' : 'Add your own key in settings'}
          </Link>
        </p>
      </Section>

      <Section title={ru ? 'Почему Pro всё-таки берут' : 'Why people take Pro anyway'}>
        {/* The honest reason the plan exists. The same fact is already stated in the BYOK card in
            Settings, so saying it here is consistency, not a sales pitch. */}
        <p>
          {ru
            ? 'Свой ключ достать может не каждый: Groq, OpenRouter, Cerebras, Gemini и OpenAI блокируют доступ из России — нужен VPN. Из доступного без VPN остаётся немногое, и оно тоже платное.'
            : 'Getting your own key is not equally easy for everyone: Groq, OpenRouter, Cerebras, Gemini and OpenAI block access from Russia, so a VPN is required. What is left without one is limited, and also paid.'}
        </p>
        <p>
          {ru
            ? 'Pro решает именно это: те же разборы работают на нашем ключе, сразу, без VPN и без настройки. Вы платите не за функции — они есть и бесплатно, — а за то, что они работают.'
            : 'That is what Pro is for: the same explanations, on our key, immediately, with no VPN and no setup. You are not paying for the features — those are free too — but for them working.'}
        </p>
        {canBuy && price && (
          <p className="text-content">
            {ru
              ? `${price} за ${monthly.days} дней. Подписка не продлевается автоматически: когда период закончится, доступ к разборам просто прекратится, пока вы не оплатите следующий.`
              : `${price} for ${monthly.days} days. The subscription does not renew automatically: when the period ends the explanations simply switch off until you pay for the next one.`}
          </p>
        )}
        {!canBuy && (
          <p className="text-content">
            {ru
              ? 'Оплата скоро появится. Пока её нет, разборы доступны со своим ключом — это тот же результат, и он бесплатный.'
              : 'Payment is not open yet. Until it is, the explanations are available with your own key — the same result, at no cost.'}
          </p>
        )}
      </Section>

      <Section title={ru ? 'Пробный период' : 'The free trial'}>
        <p>
          {ru
            ? 'Pro можно попробовать 14 дней бесплатно, карта не нужна. Пробный период даёт ограниченный запас запросов и выдаётся один раз.'
            : 'You can try Pro free for 14 days, no card required. The trial comes with a limited budget of requests and is granted once.'}
        </p>
        <p>
          {/* Said in the same breath on purpose: a trial button that silently fails for an anonymous
              user is worse than no trial button. */}
          {ru
            ? 'Для пробного периода нужен аккаунт — без email, только ключ восстановления, который вы сохраняете сами. Создать его можно в настройках за минуту.'
            : 'The trial needs an account — no email, just a recovery key that you keep yourself. You can create one in settings in a minute.'}
        </p>
        <p>
          {ru
            ? 'Когда пробный период или оплаченный месяц закончится: разборы вернутся к вашему ключу, а выгрузка в облако остановится. Ничего при этом не пропадает — облачная копия сохраняется, её по-прежнему можно загрузить на устройство, а новые изменения продолжают копиться локально и уйдут наверх, как только подписка снова активна. Курс, читалка, повторения и словарь не меняются вообще.'
            : 'When the trial or a paid month ends: the explanations go back to needing your own key, and uploading to the cloud stops. Nothing is lost — the cloud copy is kept and can still be downloaded to a device, and new changes keep accumulating locally and go up as soon as a plan is active again. The course, the reader, reviews and the vocabulary do not change at all.'}
        </p>
      </Section>

      {/* Kept as the LAST argument, never the first: the buyer is paying for a service with an offer,
          a refund policy and consumer-protection law behind it. Funding the project is a true and
          welcome consequence of that purchase, not what the purchase is. */}
      <Section title={ru ? 'Куда идут деньги' : 'Where the money goes'}>
        <p>
          {ru
            ? 'Приложение делает один человек в свободное время. Здесь нет рекламы, инвесторов и продажи данных — подписка это единственный доход проекта. Она оплачивает серверы, хранилище и ключ ИИ, и она же позволяет курсу, читалке и повторениям оставаться бесплатными для всех остальных.'
            : 'This app is built by one person in their spare time. There are no ads, no investors and no data sales — the subscription is the project\'s only income. It pays for the servers, the storage and the AI key, and it is what lets the course, the reader and the reviews stay free for everyone else.'}
        </p>
        <p>
          {ru
            ? 'Если Pro вам не нужен, а поддержать проект хочется — для этого есть отдельная страница, и она ничего не открывает.'
            : 'If you do not need Pro but would like to support the project anyway, there is a separate page for that — and it unlocks nothing.'}{' '}
          <Link to="/support" className="text-teal hover:underline">
            {ru ? 'Поддержать проект' : 'Support the project'}
          </Link>
        </p>
      </Section>

      <p className="mt-8 border-t border-line pt-6 text-2xs text-muted">
        <Link to="/terms" className="text-teal hover:underline">
          {ru ? 'Условия и публичная оферта' : 'Terms and public offer'}
        </Link>
        {' · '}
        <Link to="/privacy" className="text-teal hover:underline">
          {ru ? 'Конфиденциальность' : 'Privacy'}
        </Link>
      </p>
    </article>
  );
}
