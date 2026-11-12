import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { installEnvironment } from '@/features/android-install/environment';
import {
  hideAndroidInstall,
  RUSTORE_URL,
} from '@/features/android-install/memory';
import mark from '@/assets/brand/dayenglish-mark.svg';
import badge from '@/assets/brand/rustore-badge.svg';
import '@/features/android-install/android-install.css';

function StoreActions({ ru }: { ru: boolean }) {
  const environment = installEnvironment();
  const [copy, setCopy] = useState<'idle' | 'pending' | 'copied' | 'manual'>(
    'idle'
  );
  const generation = useRef(0),
    locked = useRef(false),
    input = useRef<HTMLInputElement>(null);
  const id = useId();
  const invalidate = useCallback(() => {
    generation.current++;
    locked.current = false;
  }, []);
  useEffect(() => {
    const reset = () => {
      invalidate();
      setCopy((s) => (s === 'pending' ? 'idle' : s));
    };
    window.addEventListener('pagehide', reset);
    return () => {
      invalidate();
      window.removeEventListener('pagehide', reset);
    };
  }, [invalidate]);
  useEffect(() => {
    if (copy === 'manual') {
      input.current?.focus({ preventScroll: true });
      input.current?.select();
    }
  }, [copy]);
  if (environment === 'native')
    return (
      <p className="android-native-note">
        <AppIcon name="phone" />
        {ru
          ? 'Вы уже в Android-приложении. Установка здесь не нужна.'
          : 'You are already in the Android app. No installation is needed.'}
      </p>
    );
  const copyUrl = async () => {
    if (locked.current) return;
    locked.current = true;
    const ticket = ++generation.current;
    setCopy('pending');
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(RUSTORE_URL);
      if (generation.current === ticket) setCopy('copied');
    } catch {
      if (generation.current === ticket) setCopy('manual');
    } finally {
      if (generation.current === ticket) locked.current = false;
    }
  };
  const hint =
    environment === 'ios'
      ? ru
        ? 'Приложение только для Android. На iPhone можно продолжать в браузере.'
        : 'This app is for Android. On iPhone, keep learning in your browser.'
      : environment === 'standalone'
        ? ru
          ? 'Вы уже используете веб-приложение. Android-версия — отдельная установка.'
          : 'You are using the web app. The Android version is a separate installation.'
        : environment === 'other'
          ? ru
            ? 'Приложение для Android. Скопируйте ссылку и откройте её на телефоне.'
            : 'An app for Android. Copy the link and open it on your phone.'
          : ru
            ? 'Откроется страница DayEnglish в RuStore.'
            : 'Opens the DayEnglish page in RuStore.';
  return (
    <div className="android-download">
      <a
        className="android-store-badge"
        href={RUSTORE_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => hideAndroidInstall('store')}
      >
        <img
          src={badge}
          width="188"
          height="63"
          alt={ru ? 'Скачайте из RuStore' : 'Download from RuStore'}
        />
        <span className="sr-only">
          {ru
            ? ' — DayEnglish для Android, новая вкладка'
            : ' — DayEnglish for Android, new tab'}
        </span>
      </a>
      <p className="android-platform-hint">{hint}</p>
      <button
        type="button"
        className="android-copy"
        disabled={copy === 'pending'}
        aria-busy={copy === 'pending' || undefined}
        aria-describedby={id + '-status'}
        onClick={() => void copyUrl()}
      >
        <AppIcon name="copy" />
        {ru ? 'Скопировать ссылку' : 'Copy link'}
      </button>
      <p role="status" id={id + '-status'} className="android-copy-status">
        {copy === 'pending'
          ? ru
            ? 'Копируем ссылку…'
            : 'Copying link…'
          : copy === 'copied'
            ? ru
              ? 'Ссылка скопирована. Откройте её на Android-телефоне.'
              : 'Link copied. Open it on an Android phone.'
            : copy === 'manual'
              ? ru
                ? 'Автоматическое копирование недоступно. Ссылка ниже.'
                : 'Automatic copying is unavailable. The link is below.'
              : ''}
      </p>
      {copy === 'manual' && (
        <div className="android-copy-fallback">
          <label htmlFor={id + '-url'}>
            {ru ? 'Скопируйте ссылку вручную' : 'Copy the link manually'}
          </label>
          <input
            ref={input}
            id={id + '-url'}
            readOnly
            value={RUSTORE_URL}
            spellCheck={false}
            onClick={(e) => e.currentTarget.select()}
          />
          <button
            type="button"
            onClick={() => {
              input.current?.focus();
              input.current?.select();
            }}
          >
            {ru ? 'Выделить ссылку' : 'Select link'}
          </button>
        </div>
      )}
    </div>
  );
}

function AndroidInstallDetails() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const faq = [
    [
      t('А если RuStore ещё не установлен?', 'What if I do not have RuStore?'),
      t(
        'Откройте карточку DayEnglish. Если нужна установка магазина, воспользуйтесь официальной инструкцией RuStore, затем вернитесь к карточке приложения.',
        'Open the DayEnglish listing. If you need to install the store, follow the official RuStore instructions, then return to the app listing.'
      ),
    ],
    [
      t('Что доступно без интернета?', 'What works offline?'),
      t(
        'Заранее загруженные материалы, локальные книги и повторения. Для онлайн-перевода, ИИ, синхронизации и загрузки книг из каталога нужен интернет. Озвучка зависит от доступных голосов.',
        'Previously downloaded materials, local books and reviews. Online translation, AI, sync and downloading books from the catalogue require internet. Speech depends on available voices.'
      ),
    ],
    [
      t('Нужно ли платить за приложение?', 'Does the app cost money?'),
      t(
        'Основной курс, грамматика, читалка и повторение слов остаются бесплатными. Дополнительные ИИ-возможности и синхронизация доступны с Pro или триалом.',
        'The core course, grammar reference, reader and vocabulary reviews remain free. Additional AI features and sync are available with Pro or a trial.'
      ),
    ],
    [
      t('У меня iPhone. Что делать?', 'What about iPhone?'),
      t(
        'Это приложение для Android. На iPhone можно пользоваться сайтом и добавить его на экран «Домой» через меню «Поделиться» в Safari.',
        'This app is for Android. On iPhone, use the website and add it to your Home Screen from the Share menu in Safari.'
      ),
    ],
  ];
  return (
    <div className="android-page">
      <Link to="/" className="android-back">
        ← {t('Вернуться к занятиям', 'Back to learning')}
      </Link>
      <div className="android-hero">
        <section className="android-pitch" aria-labelledby="android-title">
          <p className="android-eyebrow">
            DayEnglish {t('для Android', 'for Android')} · RuStore
          </p>
          <h1 id="android-title" tabIndex={-1}>
            {t('Ближе, чем', 'Closer than')}
            <br />
            <span>{t('ещё одна вкладка.', 'another browser tab.')}</span>
          </h1>
          <p className="android-lead">
            {t(
              'Тот же английский на каждый день. Теперь — на экране вашего телефона.',
              'The same daily English. Now on your phone’s home screen.'
            )}
          </p>
          <ul className="android-benefits">
            {[
              t(
                'Уроки, книги и словарь — вместе',
                'Lessons, books and vocabulary — together'
              ),
              t(
                'Заранее загруженное — без сети',
                'Downloaded materials work offline'
              ),
              t('Основной курс — бесплатно', 'The core course is free'),
            ].map((text) => (
              <li key={text}>
                <span aria-hidden="true">✓</span>
                {text}
              </li>
            ))}
          </ul>
          <StoreActions ru={ru} />
        </section>
        <figure className="android-phone-scene">
          <div className="android-orbit" />
          <div className="android-phone" aria-hidden="true">
            <div className="android-phone-notch" />
            <div className="android-phone-brand">
              <img src={mark} alt="" width="25" height="25" />
              dayenglish<span>✳</span>
            </div>
            <div className="android-phone-greeting">
              {t('Доброе утро.', 'Good morning.')}
              <br />
              <strong>Let’s keep going.</strong>
            </div>
            <div className="android-phone-day">
              <small>{t('День 8', 'Day 8')} · A1</small>
              <b>{t('Вещи вокруг нас', 'Everyday things')}</b>
              <span className="android-phone-flower">✳</span>
              <div className="android-phone-meter">
                <span />
              </div>
              <p>{t('Продолжить день', 'Continue learning')} →</p>
            </div>
            <div className="android-phone-word">
              <small>{t('Слово дня', 'Word of the day')}</small>
              <strong>curiosity</strong>
              <span>/ˌkjʊəriˈɒsəti/</span>
              <p>{t('любопытство', 'a desire to learn')}</p>
            </div>
            <div className="android-phone-tabs">
              {(['today', 'library', 'vocabulary', 'more'] as const).map(
                (icon) => (
                  <AppIcon key={icon} name={icon} />
                )
              )}
            </div>
          </div>
          <figcaption>
            {t(
              'Иллюстрация приложения. Знакомое место для нового шага.',
              'App illustration. A familiar place for your next step.'
            )}
          </figcaption>
        </figure>
      </div>
      <aside className="android-transfer">
        <AppIcon name="library" />
        <div>
          <h2>
            {t(
              'Уже занимаетесь в браузере?',
              'Already learning in your browser?'
            )}
          </h2>
          <p>
            {t(
              'Установка сама по себе не перенесёт прогресс и книги. Синхронизация подключается отдельно через аккаунт с Pro или триалом. Локальные книги можно добавить в приложение заново.',
              'Installing the app does not automatically transfer your progress or books. Enable sync separately with an account and Pro or a trial. You can also import local books into the app again.'
            )}
          </p>
          <Link to="/settings/account">
            {t(
              'Настройки аккаунта и синхронизации',
              'Account and sync settings'
            )}{' '}
            →
          </Link>
        </div>
      </aside>
      <section
        className="android-details"
        aria-labelledby="android-details-title"
      >
        <div>
          <p className="android-eyebrow">
            {t('Полезно знать', 'Good to know')}
          </p>
          <h2 id="android-details-title">
            {t('Всё без лишних сюрпризов.', 'No unnecessary surprises.')}
          </h2>
          <p>
            {t(
              'Можно продолжать заниматься в браузере. Установка — ваш выбор.',
              'You can keep learning in your browser. Installing the app is your choice.'
            )}
          </p>
        </div>
        <div className="android-faq">
          {faq.map(([question, answer], i) => (
            <details key={question}>
              <summary>{question}</summary>
              <p>{answer}</p>
              {i === 0 && (
                <a
                  href="https://www.rustore.ru/help/users/start/app-install"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {t(
                    'Официальная инструкция RuStore',
                    'Official RuStore instructions'
                  )}{' '}
                  <AppIcon name="external" />
                  <span className="sr-only">
                    {t(' — новая вкладка', ' — new tab')}
                  </span>
                </a>
              )}
            </details>
          ))}
        </div>
      </section>
      <Link className="android-back" to="/about">
        {t('Подробнее о DayEnglish', 'More about DayEnglish')} →
      </Link>
    </div>
  );
}

export function AndroidAppPage() {
  const location = useLocation();
  return <AndroidInstallDetails key={location.key} />;
}
