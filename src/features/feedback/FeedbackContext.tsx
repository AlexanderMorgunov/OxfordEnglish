import { Fragment } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import type { FeedbackOutboxItem } from '@/db/db';

export function FeedbackContext({
  body,
  sent = false,
}: {
  body: FeedbackOutboxItem['body'];
  sent?: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const fields: [string, string][] = [
    ['app_version', ru ? 'Версия' : 'Version'],
    ['page', ru ? 'Страница' : 'Page'],
    ['ui_language', ru ? 'Язык интерфейса' : 'UI language'],
    ['level', ru ? 'Уровень' : 'Level'],
    ['online_at_submit', ru ? 'Сеть при отправке' : 'Online when submitted'],
    ['user_agent', ru ? 'Браузер / устройство' : 'Browser / device'],
    ['submission_id', ru ? 'Номер сообщения' : 'Submission ID'],
  ];
  return (
    <details className="fb-payload-details">
      <summary>
        {sent
          ? ru
            ? 'Данные этого сообщения'
            : 'Details of this message'
          : ru
            ? 'Что отправится вместе с сообщением'
            : 'What is sent with your message'}
        <span aria-hidden="true">⌄</span>
      </summary>
      <p>
        {ru
          ? 'Сервису доставки передаются выбранная тема, ваш текст, почта (если указана) и технические данные ниже. Они помогают понять, где искать проблему. Не добавляйте пароли или ключи доступа.'
          : 'Your topic, message, email (if provided), and the technical details below are sent to the delivery service to help locate the problem. Do not include passwords or access keys.'}
      </p>
      <dl>
        {fields
          .filter(([key]) => body[key] != null)
          .map(([key, label]) => (
            <Fragment key={key}>
              <dt>{label}</dt>
              <dd>{String(body[key])}</dd>
            </Fragment>
          ))}
      </dl>
      <p>
        {ru
          ? 'При сбое сообщение сохраняется на этом устройстве и отправляется при следующем запуске приложения или восстановлении сети.'
          : 'If delivery fails, the message is saved on this device and retried when the app starts or reconnects.'}
      </p>
    </details>
  );
}
