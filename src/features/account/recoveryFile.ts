/**
 * The text of the file offered on the save-your-key screen.
 *
 * Its own module because it is the artefact people actually keep — the one thing standing between a lost
 * key and a lost account — and it should be testable without rendering a settings page.
 *
 * It carries the account id as well as the key. The id is not a secret and is derivable from the key, so
 * for anyone holding the key it is redundant; it matters precisely when the key is gone, which is when
 * recovery asks for it and when it exists nowhere else.
 */
export function recoveryFileBody(recoveryKey: string, accountId: string | null, ru: boolean): string {
  const lines = ru
    ? [
        'DayEnglish — данные для восстановления доступа',
        '',
        'Ключ восстановления (храните в тайне — он и есть доступ к аккаунту):',
        recoveryKey,
        '',
        'ID аккаунта (не тайна; его спрашивают при восстановлении, если ключ потерян):',
        accountId ?? '—',
        '',
        'Если ключ потерян, вернуть аккаунт можно только по ID вместе с кодом из',
        'приложения-аутентификатора. Подключить его: Настройки → Аккаунт → Запасной вход.',
      ]
    : [
        'DayEnglish — account recovery details',
        '',
        'Recovery key (keep it secret — it IS access to the account):',
        recoveryKey,
        '',
        'Account id (not a secret; recovery asks for it when the key is lost):',
        accountId ?? '—',
        '',
        'With the key lost, the only way back is this id plus a code from your',
        'authenticator app. Connect one: Settings → Account → Backup sign-in.',
      ];
  return lines.concat('').join('\n');
}
