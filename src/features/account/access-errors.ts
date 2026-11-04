export function accessErrorText(code: string, ru: boolean): string {
  const messages: Record<string, [string, string]> = {
    login_invalid: [
      'От 4 до 24 символов: латинские буквы, цифры и _. Начните с буквы.',
      'Use 4–24 letters, digits or underscores. Start with a letter.',
    ],
    login_taken: [
      'Этот логин уже занят. Выберите другой — пароль сохранён.',
      'This username is taken. Choose another — your password is kept.',
    ],
    password_short: [
      'Нужно не меньше 15 символов. Можно использовать фразу с пробелами.',
      'Use at least 15 characters. A phrase with spaces works well.',
    ],
    password_long: [
      'Допустимо не больше 128 символов. Пароль не обрезан.',
      'Use up to 128 characters. Your password has not been truncated.',
    ],
    password_weak: [
      'Этот пароль слишком распространён или предсказуем. Придумайте другую фразу.',
      'This password is too common or predictable. Choose another phrase.',
    ],
    password_mismatch: ['Пароли не совпадают.', 'Passwords do not match.'],
    invalid_credentials: [
      'Не удалось войти. Проверьте логин и пароль или используйте восстановление.',
      'Could not sign in. Check your username and password or recover access.',
    ],
    invalid_recovery: [
      'Проверьте логин и код. Для приложения возьмите новый код; резервный код должен быть неиспользованным.',
      'Check the username and code. Use a fresh authenticator code or an unused backup code.',
    ],
    invalid_code: [
      'Код не подошёл. Проверьте время на телефоне и введите новый код.',
      'This code did not work. Check the time on your phone and enter a fresh code.',
    ],
    rate_limited: [
      'Слишком много попыток. Подождите 15 минут и повторите.',
      'Too many attempts. Wait 15 minutes and try again.',
    ],
    proof_expired: [
      'Проверка доступа истекла или уже использована. Подтвердите доступ ещё раз.',
      'This access check has expired or was already used. Verify access again.',
    ],
    enrollment_expired: [
      'Настройка истекла. Начните подключение заново.',
      'Setup has expired. Start again.',
    ],
    operation_unknown: [
      'Сервер пока не подтвердил результат. Проверьте ещё раз или повторите тот же запрос безопасно.',
      'The server has not confirmed the result yet. Check again or safely resend the same request.',
    ],
    operation_expired: [
      'Результат больше недоступен. Проверьте состояние аккаунта или войдите с новым паролем.',
      'This result is no longer available. Check your account or sign in with the new password.',
    ],
    operation_superseded: [
      'Уже выпущен другой набор кодов. Здесь старые коды не показываются.',
      'A newer set of codes has been issued. Outdated codes are hidden.',
    ],
    codes_changed: [
      'Набор кодов изменился на другом устройстве. Проверьте состояние аккаунта.',
      'Codes changed on another device. Check your account status.',
    ],
    account_changed: [
      'Аккаунт изменился. Черновики и результаты прежнего аккаунта скрыты. Обновите страницу.',
      'The account changed. Previous drafts and results are hidden. Reload the page.',
    ],
    unauthorized: [
      'Нужно снова войти. Локальные книги и прогресс сохранены.',
      'Sign in again. Local books and progress are kept.',
    ],
    network: [
      'Ответ не пришёл. Проверьте соединение и результат операции.',
      'No response arrived. Check your connection and the operation result.',
    ],
    access_unavailable: [
      'Новый вход пока недоступен на сервере. Попробуйте позже. Вход по прежнему ключу доступен в настройках.',
      'The new sign-in is not available on the server yet. Try later. Legacy key sign-in is available in settings.',
    ],
  };
  return (
    messages[code]?.[ru ? 0 : 1] ??
    (ru
      ? 'Не удалось выполнить действие. Проверьте состояние аккаунта и повторите.'
      : 'Could not complete this action. Check your account and try again.')
  );
}
