export function campaignDeadline(endsAt: number, ru: boolean) {
  return (
    new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-GB', {
      timeZone: 'Europe/Moscow',
      day: 'numeric',
      month: 'long',
      hour: '2-digit',
      minute: '2-digit',
    }).format(endsAt - 1) + (ru ? ' МСК' : ' MSK')
  );
}
export function planLabel(days: number, ru: boolean) {
  return days === 30
    ? ru
      ? '1 месяц'
      : '1 month'
    : days === 90
      ? ru
        ? '3 месяца'
        : '3 months'
      : days === 365
        ? ru
          ? 'Год'
          : 'Year'
        : ru
          ? `${days} дней`
          : `${days} days`;
}
