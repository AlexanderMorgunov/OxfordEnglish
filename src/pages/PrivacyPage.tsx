import type { ReactNode } from 'react';
import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { SELLER } from '@/shared/seller';

/** Account and storage disclosures; operator details mirror /terms. */
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
    <article className="reading-column">
      <Eyebrow className="mb-3.5">политика конфиденциальности</Eyebrow>
      <h1 className="text-2xl font-bold tracking-tight text-balance">Политика обработки персональных данных</h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
        Коротко: приложением можно пользоваться без регистрации — тогда учебный прогресс хранится на вашем
        устройстве. Для создания аккаунта не требуются email, имя или телефон. Аккаунт (по желанию)
        нужен для подписки Pro, серверных AI-функций и синхронизации между устройствами.
      </p>

      <Section title="Без аккаунта">
        <p>
          Регистрация не обязательна. В этом режиме весь учебный прогресс хранится только на вашем устройстве
          и никуда не передаётся при обычной локальной учёбе. Обращения через форму обратной связи отправляются отдельно, по вашему действию.
        </p>
      </Section>

      <Section title="Вход и восстановление">
        <p>
          Для входа вы выбираете уникальный логин и пароль. Email, телефон и ФИО не запрашиваются.
          На сервере хранятся логин, псевдонимный идентификатор и стойкий хэш пароля, а не сам пароль.
          Восстановление можно настроить через приложение-аутентификатор и одноразовые резервные коды.
          Прежние аккаунты могут продолжать входить по сохранённому ключу и подключить логин к тому же аккаунту.
        </p>
      </Section>

      <Section title="Что хранится при наличии аккаунта">
        <ul className="list-disc space-y-1 pl-5">
          <li>Учебные данные: карточки повторения, статусы слов, выполненные упражнения, результаты контрольных, закладки, уровень и позиции чтения.</li>
          <li>Загруженные книги — только если вы включили их синхронизацию (файлы + позиция чтения).</li>
          <li>Технические данные: идентификатор установки (устройства), служебные метки сессии, IP-адрес на время запроса (для защиты от злоупотреблений).</li>
          <li>Данные доступа: логин, хэш пароля, зашифрованный секрет аутентификатора и хэши резервных кодов, если восстановление настроено. Кратковременные зашифрованные результаты операций помогают безопасно проверить запрос при потере ответа; счётчики попыток используют HMAC.</li>
        </ul>
        <p>Специальные категории данных (здоровье, биометрия и т. п.) не обрабатываются.</p>
      </Section>

      <Section title="Цели и основание">
        <p>
          Данные обрабатываются для входа и восстановления доступа, синхронизации и резервного копирования прогресса,
          предоставления подписки и защиты сервиса. Основание — ваше согласие, выражаемое при создании аккаунта. Согласие можно отозвать,
          удалив аккаунт.
        </p>
      </Section>

      <Section title="Где хранятся данные">
        <p>Данные аккаунта хранятся на серверах в Российской Федерации (Yandex Cloud, ru-central1) — пока аккаунт активен.</p>
      </Section>

      <Section title="Английская диктовка">
        <p>Микрофон включается только по нажатию «Начать», для одного короткого фрагмента. Приложение не сохраняет аудио, не отправляет его на свой сервер и не синхронизирует. Распознанный текст сначала доступен для проверки; вставка, перевод и сохранение в словарь выполняются отдельно.</p>
        <p>В режиме «На устройстве» аудио обрабатывается локально; нужна доступная английская модель. Автоматического перехода к сетевому распознаванию нет. Если вы явно выбираете «Системный сервис», аудио может передаваться поставщику службы распознавания браузера или Android по его правилам; может потребоваться интернет. Загрузка модели управляется браузером или системой и может продолжаться после закрытия ввода.</p>
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

      <Section title="Обратная связь">
        <p>
          При отправке обращения передаются выбранная тема, текст, добровольно
          указанный адрес почты и технические данные, показанные в форме: версия
          приложения, страница, язык, уровень, браузер, состояние сети и номер
          сообщения. Для доставки может использоваться Web3Forms или настроенный
          оператором сервис. Почта используется для ответа и уточнения деталей
          обращения.
        </p>
        <p>
          Перед отправкой сообщение сохраняется в локальную очередь. При сбое
          оно остаётся на устройстве; приложение повторяет доставку при запуске
          или восстановлении сети. Неотправленный черновик хранится только в
          памяти приложения. Не указывайте пароли и ключи доступа.
        </p>
      </Section>

      <Section title="Удаление данных">
        <p>
          Удалить аккаунт, данные доступа, учебные данные и загруженные книги можно в разделе Настройки → Аккаунт.
          Если просто перестать пользоваться аккаунтом, это само по себе не удаляет серверные данные.
        </p>
      </Section>

      <Section title="Безопасность">
        <p>
          Передача — по HTTPS. Пароли защищены Argon2id. Сам прежний ключ не хранится: на сервере остаётся его
          хэш-верификатор. Секрет аутентификатора зашифрован, резервные коды хранятся в виде хэшей.
          Токены сессии хранятся на вашем устройстве. Восстановление пароля отзывает прежние входы и старый ключ.
        </p>
      </Section>

      <Section title="Локальное хранилище">
        <p>
          Для работы входа и синхронизации используется локальное хранилище устройства (в т. ч. токен сессии).
          Его отключение сделает вход невозможным, но не помешает пользоваться приложением без аккаунта.
        </p>
        <p>На устройстве хранится короткая диагностика входа: тип события, дата и версия приложения. В ней нет ключей, токенов или идентификаторов аккаунта; она не отправляется автоматически.</p>
      </Section>

      <Section title="Оператор и изменения">
        <p>
          Оператор: {SELLER.name}, самозанятый, ИНН {SELLER.inn}. Контакт по вопросам данных:{' '}
          <a href={`mailto:${SELLER.email}`} className="text-teal hover:underline">
            {SELLER.email}
          </a>
          .
        </p>
        <p>Актуальная версия политики публикуется на этой странице. Дата обновления: 2 ноября 2026 г.</p>
      </Section>
    </article>
  );
}

function En() {
  return (
    <article className="reading-column">
      <Eyebrow className="mb-3.5">privacy policy</Eyebrow>
      <h1 className="text-2xl font-bold tracking-tight text-balance">Privacy</h1>
      <p className="mt-3 text-sm leading-relaxed text-pretty text-muted">
        In short: you can use the app without an account — then learning progress stays on your device. No email,
        name or phone is required to create an account. An optional account enables Pro, managed AI and cross-device sync.
      </p>

      <Section title="Without an account">
        <p>Registration is optional. During ordinary local study, learning progress stays on your device. Feedback messages are sent separately, when you submit them.</p>
      </Section>

      <Section title="Sign-in and recovery">
        <p>
          Choose a unique username and password. No email, phone or legal name is requested.
          The server stores the username, a pseudonymous identifier and a strong password hash, never the password.
          Optional recovery uses an authenticator and one-use backup codes. Existing key accounts can keep
          signing in with their saved key and add a username to the same account.
        </p>
      </Section>

      <Section title="What is stored with an account">
        <ul className="list-disc space-y-1 pl-5">
          <li>Learning data: SRS cards, word statuses, completed exercises, checkpoint results, bookmarks, level and reading positions.</li>
          <li>Imported books — only if you enable book-file sync (files + reading position).</li>
          <li>Technical data: an install (device) id, session markers, and your IP address for the duration of a request (abuse protection).</li>
          <li>Access data: username, password hash, encrypted authenticator secret and backup-code hashes if recovery is enabled. Short-lived encrypted operation receipts safely reconcile lost replies; attempt counters use HMAC.</li>
        </ul>
        <p>Special categories of data (health, biometrics, etc.) are not processed.</p>
      </Section>

      <Section title="Purpose and basis">
        <p>Data is processed for sign-in and recovery, sync and progress backup, subscriptions and abuse protection. The basis is your consent, given when you create an account. You can withdraw it by deleting the account.</p>
      </Section>

      <Section title="Where data is stored">
        <p>Account data is stored on servers in the Russian Federation (Yandex Cloud, ru-central1) while the account is active.</p>
      </Section>

      <Section title="English dictation">
        <p>The microphone starts only when you press Start, for one short utterance. The app does not store audio, send it to its server or sync it. Recognized text is first available for review; applying, translating and saving it to vocabulary are separate actions.</p>
        <p>On device mode processes audio locally and requires an available English model. There is no automatic switch to network recognition. If you explicitly select System service, audio may be sent to the browser or Android recognition provider under its policies and connectivity may be required. Browser or system model downloads may continue after closing input.</p>
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

      <Section title="Feedback">
        <p>
          When you submit feedback, the topic, message, optional reply email and
          the technical details shown in the form are sent: app version, page,
          language, level, browser, network state and submission ID. Delivery
          may use Web3Forms or the operator’s configured service. The email is
          used to reply and clarify your report.
        </p>
        <p>
          The message is saved to a local queue before delivery. Failed attempts
          remain on your device and are retried when the app starts or
          reconnects. Unsubmitted drafts stay only in the app’s memory. Do not
          include passwords or access keys.
        </p>
      </Section>

      <Section title="Deleting your data">
        <p>
          Delete your account, access credentials, learning data and uploaded books in Settings → Account.
          Simply stopping use of the account does not delete server data.
        </p>
      </Section>

      <Section title="Security">
        <p>Traffic uses HTTPS. Passwords are protected with Argon2id. Legacy keys are stored only as hashed verifiers. Authenticator secrets are encrypted and backup codes are hashed. Session tokens live on your device. Password recovery revokes previous sessions and the legacy key.</p>
      </Section>

      <Section title="Local storage">
        <p>Sign-in and sync use your device's local storage (including the session token). Disabling it makes signing in impossible but does not affect using the app without an account.</p>
        <p>A short sign-in diagnostic stays on your device: event type, time and app version. It contains no keys, tokens or account identifiers and is not sent automatically.</p>
      </Section>

      <Section title="Operator and changes">
        <p>
          Operator: Alexander Morgunov, self-employed, TIN 361302397520. Data contact:{' '}
          <a href="mailto:morgunowalex@gmail.com" className="text-teal hover:underline">
            morgunowalex@gmail.com
          </a>
          .
        </p>
        <p>The current version is published on this page. Updated: 2 November 2026.</p>
      </Section>
    </article>
  );
}
