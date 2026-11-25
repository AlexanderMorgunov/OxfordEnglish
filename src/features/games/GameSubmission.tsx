import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useActivityNavigationGuard } from '@/shared/lib/activity-navigation';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { collectContext, submitFeedback } from '@/features/feedback/service';
import { Button } from '@/shared/ui/Button';
import { Dialog } from '@/shared/ui/Dialog';

export function GameSubmission() {
  const lang = useUiLang((s) => s.lang),
    ru = lang === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [email, setEmail] = useState('');
  const [rights, setRights] = useState(false);
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<'sent' | 'queued' | null>(null);
  const [error, setError] = useState('');
  const lock = useRef(false),
    controller = useRef<AbortController | null>(null);
  const submissionId = useRef(crypto.randomUUID());
  const dirty = !result && Boolean(name || url || description || email);
  const blocker = useActivityNavigationGuard(dirty);
  useEffect(() => {
    const unsubscribe = subscribeDataScope(() => {
      controller.current?.abort();
      setReview(false);
      setBusy(false);
      lock.current = false;
      setName('');
      setUrl('');
      setDescription('');
      setEmail('');
      setRights(false);
      setResult(null);
      setError('');
      submissionId.current = crypto.randomUUID();
    });
    return () => {
      controller.current?.abort();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const message = `${t('Предложение игры для DayEnglish', 'Game submission for DayEnglish')}\n\n${name.trim()}\n${url.trim()}\n\n${description.trim()}\n\n${t('Автор подтверждает права на материалы.', 'The author confirms the rights to the materials.')}`;
  const send = async () => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    const attempt = new AbortController();
    controller.current = attempt;
    const current = captureDataScope();
    try {
      const receipt = await submitFeedback(
        { category: 'idea', text: message, email },
        collectContext('/games/submit', lang, 'not set'),
        { signal: attempt.signal, current, submissionId: submissionId.current }
      );
      if (current() && !attempt.signal.aborted) {
        setResult(receipt.status);
        setReview(false);
      }
    } catch {
      if (current() && !attempt.signal.aborted)
        setError(
          t(
            'Не удалось отправить или сохранить заявку. Текст остался в форме. Попробуйте ещё раз.',
            'Could not send or save the submission. Your text remains in the form. Please retry.'
          )
        );
    } finally {
      if (!attempt.signal.aborted) {
        lock.current = false;
        setBusy(false);
      }
    }
  };
  return (
    <div className="games-catalog games-submission">
      <Link className="games-back" to="/games">
        ← {t('Все игры', 'All games')}
      </Link>
      <header className="games-intro">
        <div>
          <p className="games-eyebrow">{t('Для авторов', 'For creators')}</p>
          <h1>{t('Давайте играть и учиться.', 'Let’s play and learn.')}</h1>
          <p>
            {t(
              'Расскажите о своей игре. Мы посмотрим материалы и обсудим возможность добавить её в DayEnglish.',
              'Tell us about your game. We will review it and discuss bringing it to DayEnglish.'
            )}
          </p>
        </div>
      </header>
      {result ? (
        <section className="games-status" role="status">
          <h2>
            {result === 'sent'
              ? t('Заявка отправлена', 'Submission sent')
              : t(
                  'Заявка сохранена на устройстве',
                  'Submission saved on this device'
                )}
          </h2>
          <p>
            {result === 'sent'
              ? t(
                  'Ответим на указанный email, если сможем предложить следующий шаг.',
                  'We will reply to your email if we can offer a next step.'
                )
              : t(
                  'Отправка не подтверждена. Повторить её можно в разделе «Обратная связь», в списке неотправленных сообщений.',
                  'Delivery has not been confirmed. Retry from the pending messages in Feedback.'
                )}
          </p>
          <Link
            className="games-text-link"
            to={result === 'queued' ? '/feedback' : '/games'}
          >
            {result === 'queued'
              ? t('Открыть обратную связь', 'Open feedback')
              : t('Вернуться к играм', 'Back to games')}
          </Link>
        </section>
      ) : (
        <div className="games-detail-columns">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              try {
                const value = new URL(url);
                if (
                  value.protocol !== 'https:' ||
                  value.username ||
                  value.password
                )
                  throw Error();
              } catch {
                setError(
                  t(
                    'Укажите HTTPS-ссылку без логина и пароля.',
                    'Enter an HTTPS URL without credentials.'
                  )
                );
                return;
              }
              if (!name.trim() || !description.trim() || !rights) {
                setError(
                  t(
                    'Заполните название, описание и подтвердите права.',
                    'Provide a name and description and confirm your rights.'
                  )
                );
                return;
              }
              setError('');
              setReview(true);
            }}
          >
            <label className="game-field">
              {t('Название игры', 'Game title')}
              <input
                required
                maxLength={120}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="game-field">
              {t(
                'Ссылка на игру или видео прохождения',
                'Game or walkthrough URL'
              )}
              <input
                required
                type="url"
                maxLength={1000}
                placeholder="https://"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </label>
            <label className="game-field">
              {t(
                'Как игра помогает учить английский?',
                'How does the game help people learn English?'
              )}
              <textarea
                required
                rows={5}
                maxLength={2500}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </label>
            <label className="game-field">
              {t('Email для ответа', 'Reply email')}
              <input
                required
                type="email"
                autoComplete="email"
                maxLength={254}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>
            <label className="games-check">
              <input
                type="checkbox"
                required
                checked={rights}
                onChange={(e) => setRights(e.target.checked)}
              />
              <span>
                {t(
                  'У меня есть права на игру и её материалы, необходимые для обсуждения публикации.',
                  'I have the rights to the game and its materials needed to discuss publication.'
                )}
              </span>
            </label>
            <p className="games-compatibility">
              {t(
                'Перед отправкой можно проверить заявку. Данные используются для рассмотрения и ответа.',
                'Review your submission before sending. The information is used to review and respond.'
              )}{' '}
              <Link to="/privacy">{t('Конфиденциальность', 'Privacy')}</Link>
            </p>
            {error && <p role="alert">{error}</p>}
            <Button type="submit">
              {t('Проверить заявку', 'Review submission')} →
            </Button>
          </form>
          <aside>
            <h2>
              {t(
                'Начнём с идеи и примера',
                'Start with an idea and an example'
              )}
            </h2>
            <p>
              {t(
                'Покажите, что делает игрок и чему учится. Подойдёт короткое видео или доступная демоверсия.',
                'Show what the player does and learns. A short video or a playable demo is enough.'
              )}
            </p>
            <p>
              {t(
                'Заявка не публикует игру автоматически. Условия и подключение обсудим отдельно.',
                'Submitting does not publish the game automatically. Terms and integration will be discussed separately.'
              )}
            </p>
          </aside>
        </div>
      )}
      {review && (
        <Dialog
          title={t('Проверьте заявку', 'Review your submission')}
          onClose={() => {
            if (!busy) setReview(false);
          }}
          footer={
            <>
              <Button disabled={busy} onClick={() => void send()}>
                {busy
                  ? t('Отправляем…', 'Sending…')
                  : t('Отправить на рассмотрение', 'Submit for review')}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setReview(false)}
              >
                {t('Вернуться к редактированию', 'Edit submission')}
              </Button>
            </>
          }
        >
          <p className="game-text">{message}</p>
          <p>{email}</p>
          {error && <p role="alert">{error}</p>}
        </Dialog>
      )}
      {blocker.state === 'blocked' && (
        <Dialog
          title={t('Выйти без отправки?', 'Leave without submitting?')}
          onClose={() => blocker.reset()}
          footer={
            <>
              <Button variant="ghost" onClick={() => blocker.reset()}>
                {t('Остаться', 'Stay')}
              </Button>
              <Button onClick={() => blocker.proceed()}>
                {t('Выйти', 'Leave')}
              </Button>
            </>
          }
        >
          <p>
            {t(
              'Заполненная форма не сохранится после выхода.',
              'Your form will not be kept after leaving.'
            )}
          </p>
        </Dialog>
      )}
    </div>
  );
}
