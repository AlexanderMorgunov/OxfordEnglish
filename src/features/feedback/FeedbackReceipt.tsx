import { Link } from 'react-router-dom';
import type { Ref } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { CATEGORY_LABEL } from './service';
import type { SubmitResult } from './service';
import { CATEGORIES } from './draft';
import { FeedbackContext } from './FeedbackContext';

export function FeedbackReceipt({
  result,
  busy,
  heading,
  onRetry,
  onNew,
  hasDraft,
}: {
  result: SubmitResult;
  busy: boolean;
  heading: Ref<HTMLHeadingElement>;
  onRetry: () => void;
  onNew: () => void;
  hasDraft: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    t = (rus: string, en: string) => (ru ? rus : en);
  const queued = result.status === 'queued',
    { body } = result.item;
  const category = CATEGORIES.find(
    (c) => CATEGORY_LABEL[c.id] === body.category
  );
  const explanation =
    result.reason === 'not-configured'
      ? t(
          'Отправка в этой версии приложения пока не настроена. Сообщение сохранено на устройстве. Повторите после обновления или воспользуйтесь почтой, если она указана ниже.',
          'Delivery is not configured in this app version. Your message is saved on this device. Retry after an update, or use the email link below if one is available.'
        )
      : result.reason === 'offline'
        ? t(
            'Сейчас нет интернета. Сообщение сохранено на этом устройстве и отправится, когда приложение снова будет в сети.',
            'You are offline. Your message is saved on this device and will be sent when the app reconnects.'
          )
        : result.reason === 'cancelled'
          ? t(
              'Попытка прервана. Сообщение остаётся в очереди. Если сервис уже принял его до прерывания, повторная попытка может создать копию.',
              'The attempt stopped. Your message stays in the queue. If the service accepted it before the interruption, retrying may create a duplicate.'
            )
          : result.reason === 'busy'
            ? t(
                'Отправка уже выполняется в этом приложении или другой вкладке. Дождитесь результата; сообщение сохранено.',
                'Delivery is already running in this app or another tab. Please wait; your message is saved.'
              )
            : result.reason === 'storage-error'
              ? t(
                  'Сообщение записано в очередь, но проверить отправку сейчас не удалось. Попробуйте снова.',
                  'Your message was saved to the queue, but delivery could not be checked. Try again.'
                )
              : t(
                  'Сервис пока не подтвердил доставку. Сообщение сохранено на этом устройстве. Можно повторить сейчас; приложение также попробует при следующем запуске или восстановлении сети.',
                  'The service has not confirmed delivery. Your message is saved on this device. Retry now, or let the app retry at its next launch or reconnection.'
                );
  return (
    <div className="fb-receipt">
      <div className={`fb-receipt-mark${queued ? ' fb-queued' : ''}`}>
        <AppIcon name={queued ? 'feedback' : 'today'} />
      </div>
      <p className="fb-receipt-badge">
        {queued
          ? t('Ожидает отправки', 'Awaiting delivery')
          : t('Доставка подтверждена', 'Delivery confirmed')}
      </p>
      <h2 ref={heading} tabIndex={-1}>
        {queued
          ? t('Сообщение сохранено', 'Message saved')
          : t('Спасибо, сообщение отправлено!', 'Thank you, message sent!')}
      </h2>
      <p className="fb-receipt-lede">
        {queued
          ? explanation
          : t(
              'Прочитаю ваше сообщение. Если оставили почту, смогу связаться для уточнения деталей. Ответить получается не всегда.',
              'I will read your message. If you left an email, I can contact you for details. I cannot always reply.'
            )}
      </p>
      <div className="fb-receipt-message">
        <h3>
          {category
            ? ru
              ? category.ru
              : category.en
            : String(body.category ?? t('Обратная связь', 'Feedback'))}
        </h3>
        <p>{String(body.message ?? '')}</p>
      </div>
      <p className="fb-receipt-email">
        {body.email
          ? t('Почта для ответа: ', 'Reply email: ') + String(body.email)
          : t('Почта не указана.', 'No reply email provided.')}
      </p>
      <FeedbackContext body={body} sent />
      <div className="fb-receipt-actions">
        {queued ? (
          <button
            type="button"
            className="fb-btn fb-primary"
            disabled={busy}
            onClick={onRetry}
          >
            {busy
              ? t('Отправляем…', 'Sending…')
              : t('Повторить отправку', 'Retry delivery')}
          </button>
        ) : (
          <Link to="/" className="fb-btn fb-primary">
            {t('Продолжить учёбу', 'Continue studying')}
            <span aria-hidden="true">→</span>
          </Link>
        )}
        <button
          type="button"
          className="fb-text-button"
          disabled={busy}
          onClick={onNew}
        >
          {hasDraft
            ? t('Вернуться к черновику', 'Back to draft')
            : t('Написать ещё', 'New message')}
        </button>
      </div>
      {queued && (
        <p className="fb-receipt-note">
          {t(
            'Очередь хранится только на этом устройстве. Не очищайте данные приложения до отправки.',
            'The queue is stored only on this device. Keep the app’s data until delivery.'
          )}
        </p>
      )}
      {result.cleanupFailed && (
        <p className="fb-receipt-note">
          {t(
            'Сервис подтвердил доставку, но очистить локальную запись не удалось. Повторять отправку сейчас не нужно.',
            'The service confirmed delivery, but the local record could not be cleared. There is no need to resend now.'
          )}
        </p>
      )}
    </div>
  );
}
