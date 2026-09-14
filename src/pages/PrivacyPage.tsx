import type { ReactNode } from 'react';
import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';

/** Public privacy page (slice 4d). Reflects the no-PII recovery-key model: no email/name/phone; an
 *  account is a pseudonymous id derived from a recovery key we never store. Operator details are
 *  placeholders for the owner/counsel to fill; this is not legal advice. */
export function PrivacyPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  return ru ? <Ru /> : <En />;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-8 border-t border-line pt-6">
      <h2 className="mb-2 text-lg font-bold tracking-tight">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-pretty text-muted">{children}</div>
    </section>
  );
}

function Ru() {
  return (
    <article className="max-w-prose">
      <Eyebrow className="mb-3.5">политика конфиденциальности</Eyebrow>
      <h1 className="text-2xl font-bold tracking-tight text-balance">Конфиденциальность</h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
        Коротко: приложением можно пользоваться без регистрации — тогда все данные остаются только на вашем
        устройстве. Мы не собираем email, имя, телефон и другие персональные данные. Аккаунт (по желанию)
        нужен лишь для синхронизации прогресса между устройствами.
      </p>

      <Section title="Без аккаунта">
        <p>
          Регистрация не обязательна. В этом режиме весь учебный прогресс хранится только на вашем устройстве
          и никуда не передаётся. Никакие данные оператору не поступают.
        </p>
      </Section>

      <Section title="Аккаунт без персональных данных">
        <p>
          Мы не используем email или телефон. Аккаунт — это ключ восстановления, который вы сохраняете сами.
          Из него на устройстве вычисляется псевдонимный идентификатор аккаунта; сам ключ мы не храним и
          восстановить его не можем.
        </p>
      </Section>

      <Section title="Что хранится при наличии аккаунта">
        <ul className="list-disc space-y-1 pl-5">
          <li>Учебные данные: карточки повторения, статусы слов, выполненные упражнения, результаты контрольных, закладки, уровень и позиции чтения.</li>
          <li>Загруженные книги — только если вы включили их синхронизацию (файлы + позиция чтения).</li>
          <li>Технические данные: идентификатор установки (устройства), служебные метки сессии, IP-адрес на время запроса (для защиты от злоупотреблений).</li>
        </ul>
        <p>Специальные категории данных (здоровье, биометрия и т. п.) не обрабатываются.</p>
      </Section>

      <Section title="Цели и основание">
        <p>
          Данные обрабатываются только для синхронизации и резервного копирования вашего прогресса и для
          защиты сервиса. Основание — ваше согласие, выражаемое при создании аккаунта. Согласие можно отозвать,
          удалив аккаунт.
        </p>
      </Section>

      <Section title="Где хранятся данные">
        <p>Данные аккаунта хранятся на серверах в Российской Федерации (Yandex Cloud, ru-central1) — пока аккаунт активен.</p>
      </Section>

      <Section title="Третьи лица">
        <p>Мы не продаём данные и не используем их для рекламы. Для работы сервиса привлекаются:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Yandex Cloud — хостинг, база данных и хранилище файлов (РФ);</li>
          <li>Яндекс Метрика — обезличенная веб-аналитика посещений (не связывает учёбу с личностью; работает и для анонимных пользователей; можно выключить в настройках);</li>
          <li>MyMemory — бесплатный перевод в читалке (отправляется только выделенный текст, без привязки к аккаунту);</li>
          <li>AI-провайдер по вашему ключу (BYOK) — запросы идут напрямую от вашего браузера к выбранному провайдеру, минуя наш сервер; ключ хранится только на устройстве.</li>
        </ul>
      </Section>

      <Section title="Удаление данных">
        <p>
          Удаление аккаунта и связанных данных (учебные данные и загруженные книги) выполняется по обращению
          на контакт ниже; кнопка удаления прямо в настройках появится позднее. Поскольку персональные данные
          не собираются, аккаунт можно также просто перестать использовать.
        </p>
      </Section>

      <Section title="Безопасность">
        <p>
          Передача — по HTTPS. Ключ восстановления мы не храним; на сервере хранится только его необратимый
          хэш-верификатор. Токены сессии хранятся на вашем устройстве.
        </p>
      </Section>

      <Section title="Локальное хранилище">
        <p>
          Для работы входа и синхронизации используется локальное хранилище устройства (в т. ч. токен сессии).
          Его отключение сделает вход невозможным, но не помешает пользоваться приложением без аккаунта.
        </p>
      </Section>

      <Section title="Оператор и изменения">
        <p>Оператор: [ФИО], самозанятый, ИНН [—]. Контакт по вопросам данных: [email].</p>
        <p>Актуальная версия политики публикуется на этой странице. Дата вступления в силу: [дата].</p>
      </Section>
    </article>
  );
}

function En() {
  return (
    <article className="max-w-prose">
      <Eyebrow className="mb-3.5">privacy policy</Eyebrow>
      <h1 className="text-2xl font-bold tracking-tight text-balance">Privacy</h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
        In short: you can use the app without an account — then all data stays on your device. We collect no
        email, name, phone, or other personal data. An optional account only syncs your progress across devices.
      </p>

      <Section title="Without an account">
        <p>Registration is optional. In this mode all learning progress stays on your device and is never sent anywhere.</p>
      </Section>

      <Section title="An account with no personal data">
        <p>
          We use no email or phone. An account is a recovery key you keep yourself. A pseudonymous account id is
          derived from it on your device; we never store the key and cannot recover it.
        </p>
      </Section>

      <Section title="What is stored with an account">
        <ul className="list-disc space-y-1 pl-5">
          <li>Learning data: SRS cards, word statuses, completed exercises, checkpoint results, bookmarks, level and reading positions.</li>
          <li>Imported books — only if you enable book-file sync (files + reading position).</li>
          <li>Technical data: an install (device) id, session markers, and your IP address for the duration of a request (abuse protection).</li>
        </ul>
        <p>Special categories of data (health, biometrics, etc.) are not processed.</p>
      </Section>

      <Section title="Purpose and basis">
        <p>Data is processed only to sync and back up your progress and to protect the service. The basis is your consent, given when you create an account. You can withdraw it by deleting the account.</p>
      </Section>

      <Section title="Where data is stored">
        <p>Account data is stored on servers in the Russian Federation (Yandex Cloud, ru-central1) while the account is active.</p>
      </Section>

      <Section title="Third parties">
        <p>We do not sell data or use it for advertising. Processors used to run the service:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Yandex Cloud — hosting, database and file storage (RU);</li>
          <li>Yandex Metrica — anonymous visit analytics (never linked to learning data; also active for anonymous users; can be turned off in settings);</li>
          <li>MyMemory — free reader translation (only the selected text is sent, unlinked to any account);</li>
          <li>Your BYOK AI provider — requests go directly from your browser to the provider, never through our server; the key stays on your device.</li>
        </ul>
      </Section>

      <Section title="Deleting your data">
        <p>
          Deleting your account and its data (learning data and uploaded books) is available via the contact
          below; an in-app delete button will follow. Since no personal data is collected, you can also simply
          stop using the account.
        </p>
      </Section>

      <Section title="Security">
        <p>Traffic uses HTTPS. We never store the recovery key; the server keeps only its one-way hashed verifier. Session tokens live on your device.</p>
      </Section>

      <Section title="Local storage">
        <p>Sign-in and sync use your device's local storage (including the session token). Disabling it makes signing in impossible but does not affect using the app without an account.</p>
      </Section>

      <Section title="Operator and changes">
        <p>Operator: [name], self-employed, TIN [—]. Data contact: [email].</p>
        <p>The current version is published on this page. Effective date: [date].</p>
      </Section>
    </article>
  );
}
