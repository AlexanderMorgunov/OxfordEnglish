import { useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Card, Input } from '@/shared/ui';
import { useAccount } from './store';
import { ApiFailure, totpStatus, totpEnroll, totpConfirm, totpBackupCodes, totpCancel, totpDisable } from './api';
import { deriveVerifier, splitCredential } from './keys';
import type { TotpStatus } from './contract';

/** Deriving here rather than in the store keeps the raw key out of global state: it is used once,
 *  turned into a verifier, and dropped. */
const verifierFor = (key: string): Promise<string> => deriveVerifier(splitCredential(key).key);

/**
 * Settings → Account → recovery via an authenticator app.
 *
 * Why this exists: `accountId` and the verifier are both derived from the one recovery key, so losing
 * that key loses the account outright — synced progress, books and a paid subscription with it. A
 * confirmed authenticator is the second way in. See docs/backend-v1-design.md.
 */

const accessToken = async (): Promise<string> => {
  const token = await useAccount.getState().getAccessToken();
  if (!token) throw new ApiFailure('unauthorized', 401);
  return token;
};

const withToken = async <T,>(fn: (token: string) => Promise<T>): Promise<T> => fn(await accessToken());

function errorText(code: string, ru: boolean): string {
  if (code === 'bad_key') return ru ? 'Это не похоже на код или ключ восстановления. Проверьте, что скопировали ключ целиком.' : 'That is neither a code nor a recovery key. Check you copied the whole key.';
  if (code === 'totp_invalid') return ru ? 'Неверный код. Проверьте время на телефоне и попробуйте снова.' : 'Wrong code. Check your phone’s clock and try again.';
  if (code === 'rate_limited') return ru ? 'Слишком много попыток. Подождите 15 минут.' : 'Too many attempts. Wait 15 minutes.';
  if (code === 'totp_unavailable') return ru ? 'Восстановление временно недоступно.' : 'Recovery is temporarily unavailable.';
  if (code === 'network') return ru ? 'Нет сети — попробуйте позже.' : 'Offline — try again later.';
  return ru ? 'Не удалось. Попробуйте ещё раз.' : 'Something went wrong. Try again.';
}

const codeOf = (e: unknown): string => (e instanceof ApiFailure ? e.code : 'error');

/** Codes are shown exactly once, so both a copy and a file download are offered — a screenshot of ten
 *  codes is the failure mode we are trying to avoid. */
function downloadText(name: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: 'text/plain' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}


/** Base32 in blocks of four — the shape every authenticator shows and the only one a person can read
 *  aloud or retype without losing their place. Returns the groups, never a joined string — see the
 *  render site for why the spaces must not exist in the DOM text. */
const groupKey = (secret: string): string[] => secret.match(/.{1,4}/g) ?? [secret];

/** A touch device is where an authenticator app might be installed and where the QR is unscannable. */
const coarsePointer = (): boolean => window.matchMedia?.('(pointer: coarse)').matches ?? false;

export function TotpEnroll({ ru }: { ru: boolean }) {
  const [status, setStatus] = useState<TotpStatus | null>(null);
  const [stage, setStage] = useState<'idle' | 'scanning' | 'codes' | 'disabling' | 'regenerating'>('idle');
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    void withToken(totpStatus)
      .then((s) => alive && setStatus(s))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(codeOf(e), ru));
    } finally {
      setBusy(false);
    }
  };

  const start = () =>
    run(async () => {
      const e = await withToken(totpEnroll);
      setEnrollment(e);
      setStage('scanning');
      setInput('');
      setCopied(false);
    });

  /** Copies the RAW key, not the spaced-out one on screen — most apps reject a secret with spaces. */
  const copyKey = async (secret: string) => {
    try {
      await navigator.clipboard?.writeText(secret);
      setCopied(true);
    } catch {
      setCopied(false); // no clipboard permission — the key is selectable on screen either way
    }
  };

  /**
   * Abandon a setup that was never confirmed — on the server too, not just on screen.
   *
   * Since `enroll` returns the pending secret rather than minting over it (which is what lets an
   * already-scanned QR survive a trip to the authenticator app), clearing only local state would leave
   * that secret alive forever: every later attempt would hand back the same one.
   */
  const cancelEnrollment = () =>
    run(async () => {
      await withToken(totpCancel).catch(() => undefined); // already confirmed elsewhere → nothing to drop
      setStage('idle');
      setEnrollment(null);
      setInput('');
      setCopied(false);
      setStatus((s) => (s ? { ...s, pending: false } : s));
    });

  const confirm = () =>
    run(async () => {
      const code = input.trim();
      try {
        const codes = await totpConfirm(await accessToken(), code);
        setBackupCodes(codes);
        setEnrollment(null); // the secret must not linger in memory once it is live
        setStage('codes');
        setInput('');
        setStatus((s) => (s ? { ...s, enrolled: true, backupCodesLeft: codes.length } : s));
      } catch (e) {
        // The server turned the authenticator on and the answer was lost; the codes it minted went with
        // it, shown once and stored as hashes. So ask for a fresh set — but NOT with the code just
        // typed: `confirm` records it as spent (`lastStep`), so replaying it fails as a wrong code AND
        // burns one of the ten attempts before a fifteen-minute lockout that blocks correct codes too.
        if (codeOf(e) !== 'totp_already_enrolled') throw e;
        setEnrollment(null);
        setInput('');
        setStage('regenerating');
        setStatus((s) => (s ? { ...s, enrolled: true } : s));
        setError(
          ru
            ? 'Приложение уже подключено — похоже, ответ на подтверждение потерялся. Резервные коды показываются один раз, поэтому выпустим новые: дождитесь СЛЕДУЮЩЕГО кода в приложении и введите его.'
            : 'The app is already connected — the confirmation answer seems to have been lost. Backup codes are shown only once, so we will issue a fresh set: wait for the NEXT code in the app and enter it.'
        );
      }
    });

  /** Fresh codes for someone who already has the authenticator and lost the list. */
  const regenerate = () =>
    run(async () => {
      const codes = await totpBackupCodes(await accessToken(), input.trim());
      setBackupCodes(codes);
      setStage('codes');
      setInput('');
      setStatus((s) => (s ? { ...s, backupCodesLeft: codes.length } : s));
    });

  const disable = () =>
    run(async () => {
      // Six digits is a code (a backup code goes there too — the server accepts either); anything else
      // is read as a recovery key. A malformed key throws inside keyToBytes, which would otherwise
      // surface as a generic "something went wrong" instead of telling the user what to fix.
      const v = input.trim();
      let proof: { code?: string; verifier?: string };
      if (/^\d{6}$/.test(v)) proof = { code: v };
      else {
        try {
          proof = { verifier: await verifierFor(v) };
        } catch {
          throw new ApiFailure('bad_key', 400);
        }
      }
      await withToken((t) => totpDisable(t, proof));
      setStatus({ available: true, enrolled: false, backupCodesLeft: 0 });
      setStage('idle');
      setInput('');
    });

  // Nothing at all while the server has no sealing key — a button that can only 503 is worse than silence.
  if (!status?.available) return null;

  return (
    <div className="mt-6 border-t border-line pt-5">
      <h3 className="mb-1 text-sm font-bold">{ru ? 'Запасной вход' : 'Backup sign-in'}</h3>

      {stage === 'codes' && backupCodes ? (
        <Card className="border-amber-dim bg-amber-dim/15">
          <p className="mb-2 text-sm text-content">
            {ru
              ? 'Готово. Сохраните резервные коды — они пригодятся, если телефон потеряется. Каждый работает один раз, и показываем мы их только сейчас.'
              : 'Done. Save these backup codes — they are for when the phone itself is gone. Each works once, and this is the only time they are shown.'}
          </p>
          <p className="mb-3 grid grid-cols-2 gap-x-4 gap-y-1 rounded-sm bg-surface px-3 py-2 font-mono text-sm text-teal">
            {backupCodes.map((c) => (
              <span key={c} className="select-all">
                {c}
              </span>
            ))}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(backupCodes.join('\n')).catch(() => undefined)}>
              {ru ? 'Скопировать' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => downloadText('dayenglish-backup-codes.txt', `DayEnglish backup codes\n\n${backupCodes.join('\n')}\n`)}>
              {ru ? 'Скачать .txt' : 'Download .txt'}
            </Button>
          </div>
          <Button
            size="sm"
            onClick={() => {
              setBackupCodes(null);
              setStage('idle');
              setStatus({ available: true, enrolled: true, backupCodesLeft: backupCodes.length });
            }}
          >
            {ru ? 'Я сохранил(а) коды' : 'I have saved the codes'}
          </Button>
        </Card>
      ) : stage === 'scanning' && enrollment ? (
        <Card>
          {/* The key comes FIRST. On the device that also runs the authenticator — which is where people
              actually do this — the QR cannot be scanned at all, so hiding the key behind "can't scan?"
              put the only workable route behind a question the user has to think to ask. */}
          <p className="mb-3 text-sm text-content text-pretty">
            {ru
              ? 'Добавьте этот ключ в приложение-аутентификатор (Google Authenticator, Aegis, 2FAS — подойдёт любое), затем введите шестизначный код из приложения.'
              : 'Add this key to an authenticator app (Google Authenticator, Aegis, 2FAS — any will do), then enter the six-digit code it shows.'}
          </p>

          {/* Groups are separate spans with margin, not spaces in the text: selecting the block on a
              phone and copying it would otherwise yield a secret with spaces in it, which is the exact
              paste failure the Copy button exists to avoid. */}
          <p id="totp-key" className="mb-2 select-all break-all rounded-sm bg-surface px-3 py-2 font-mono text-sm text-teal">
            {groupKey(enrollment.secret).map((g) => (
              <span key={g} className="mr-2 inline-block">
                {g}
              </span>
            ))}
          </p>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="ghost" onClick={() => void copyKey(enrollment.secret)}>
              {copied ? (ru ? 'Скопировано' : 'Copied') : ru ? 'Скопировать' : 'Copy'}
            </Button>
            {/* Only where an authenticator app could plausibly be installed. A custom scheme has no
                fallback: on a desktop, or a phone with no such app, tapping it dead-ends in a browser
                error — so the key above stays visible and this is never the only way forward. */}
            {coarsePointer() && (
              <a
                href={enrollment.uri}
                className="rounded-sm px-2.5 py-1.5 font-mono text-2xs text-violet hover:underline"
              >
                {ru ? 'Открыть в приложении →' : 'Open in the app →'}
              </a>
            )}
          </div>

          <details className="mb-4">
            <summary className="cursor-pointer font-mono text-2xs text-muted hover:text-content">
              {ru ? 'Сканировать QR с другого устройства' : 'Scan a QR from another device'}
            </summary>
            <div className="mt-2 inline-block rounded-sm bg-white p-3">
              <QRCodeSVG value={enrollment.uri} size={168} aria-hidden />
            </div>
          </details>

          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={ru ? '6 цифр' : '6 digits'}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="max-w-[9rem] font-mono"
              spellCheck={false}
            />
            <Button size="sm" disabled={busy || input.trim().length < 6} onClick={() => void confirm()}>
              {ru ? 'Подтвердить' : 'Confirm'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelEnrollment()}>
              {ru ? 'Отмена' : 'Cancel'}
            </Button>
          </div>
        </Card>
      ) : status.enrolled ? (
        <div>
          <p className="mb-1 text-sm text-content">
            {ru ? 'Приложение-аутентификатор подключено.' : 'An authenticator app is connected.'}{' '}
            <span className="text-muted">
              {ru ? `Резервных кодов осталось: ${status.backupCodesLeft}.` : `${status.backupCodesLeft} backup codes left.`}
            </span>
          </p>
          {status.backupCodesLeft <= 2 && (
            <p className="mb-1 text-2xs text-coral">
              {ru ? 'Коды почти закончились — выпустите новые.' : 'Almost out of codes — issue a fresh set.'}
            </p>
          )}
          {stage === 'regenerating' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ru ? '6 цифр из приложения' : '6 digits from the app'}
                inputMode="numeric"
                autoComplete="one-time-code"
                className="max-w-[12rem] font-mono"
                spellCheck={false}
              />
              <Button size="sm" disabled={busy || input.trim().length < 6} onClick={() => void regenerate()}>
                {ru ? 'Выпустить коды' : 'Issue codes'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setStage('idle'); setInput(''); }}>
                {ru ? 'Отмена' : 'Cancel'}
              </Button>
            </div>
          ) : stage === 'disabling' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={ru ? 'Код или ключ восстановления' : 'Code or recovery key'}
                className="max-w-xs font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button size="sm" disabled={busy || input.trim().length < 6} onClick={() => void disable()}>
                {ru ? 'Отключить' : 'Disable'}
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setStage('idle'); setInput(''); }}>
                {ru ? 'Отмена' : 'Cancel'}
              </Button>
            </div>
          ) : (
            <div className="mt-2 flex flex-wrap gap-2">
              <Button size="sm" variant="ghost" onClick={() => { setStage('regenerating'); setInput(''); }}>
                {ru ? 'Новые резервные коды' : 'New backup codes'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setStage('disabling'); setInput(''); }}>
                {ru ? 'Отключить' : 'Disable'}
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div>
          <p className="mb-2 text-sm text-muted text-pretty">
            {ru
              ? 'Ключ восстановления — единственный способ войти. Подключите приложение-аутентификатор, и если ключ потеряется, вы сможете вернуть аккаунт и выпустить новый ключ.'
              : 'The recovery key is the only way in. Connect an authenticator app and you can get the account back — and issue a new key — even if the key is lost.'}
          </p>
          {/* A setup left half-finished — the usual cause being a trip to the authenticator app that the
              browser did not survive. The server still holds that secret and `enroll` hands back the SAME
              one, so the entry already added there keeps working. Deliberately a button rather than
              something that fires on mount: `enroll` MINTS an enrollment when none exists, so an
              automatic call would create setups nobody asked for whenever this flag was stale. */}
          {status.pending && (
            <p className="mb-2 text-2xs text-amber">
              {ru
                ? 'Подключение начато, но не завершено. Можно продолжить с того же ключа — заново сканировать не нужно.'
                : 'A setup was started and never finished. You can continue with the same key — no need to scan again.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void start()}>
              {status.pending
                ? ru
                  ? 'Продолжить подключение'
                  : 'Continue setup'
                : ru
                  ? 'Подключить приложение'
                  : 'Connect an app'}
            </Button>
            {status.pending && (
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => void cancelEnrollment()}>
                {ru ? 'Начать заново' : 'Start over'}
              </Button>
            )}
          </div>
        </div>
      )}

      {error && <p className="mt-2 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}

/** Signed-out: the path for someone whose key is gone but whose authenticator still works. */
export function TotpRecover({ ru, onRecovered }: { ru: boolean; onRecovered: (composite: string) => void }) {
  const recoverWithTotp = useAccount((s) => s.recoverWithTotp);
  const busy = useAccount((s) => s.busy);
  const [accountId, setAccountId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    try {
      onRecovered(await recoverWithTotp(accountId, code));
    } catch (e) {
      setError(errorText(codeOf(e), ru));
    }
  };

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm text-muted text-pretty">
        {ru
          ? 'Откройте приложение-аутентификатор. Под названием DayEnglish указан ваш ID — впишите его сюда вместе с текущим кодом. Подойдёт и резервный код вместо шестизначного.'
          : 'Open your authenticator app. Your ID is shown under the DayEnglish entry — enter it here along with the current code. A backup code works instead of the six digits.'}
      </p>
      <div className="flex flex-col gap-2 sm:max-w-md">
        <Input
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="ID"
          className="font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={ru ? 'Код' : 'Code'}
            autoComplete="one-time-code"
            className="max-w-[11rem] font-mono"
            spellCheck={false}
          />
          <Button size="sm" disabled={busy || accountId.trim().length < 16 || code.trim().length < 6} onClick={() => void submit()}>
            {ru ? 'Восстановить' : 'Recover'}
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}
