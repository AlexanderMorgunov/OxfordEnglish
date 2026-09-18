import { useCallback, useEffect, useRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button, Card, Input } from '@/shared/ui';
import { useAccount } from './store';
import {
  ApiFailure,
  totpStatus,
  totpEnroll,
  totpConfirm,
  totpBackupCodes,
  totpCancel,
  totpDisable,
  setRecoveryName,
  clearRecoveryName,
} from './api';
import { PendingRecovery, pendingRecoveryKey } from './store';
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
  // `/recover` collapses a wrong ID, a wrong code and a spent budget into one answer on purpose — telling
  // them apart would say whether an account exists and whether it has an authenticator. So the message
  // has to name every possibility rather than pick one: it used to blame the phone's clock, sending
  // people to debug a clock that was fine.
  if (code === 'totp_invalid') {
    return ru
      ? 'Не подошло. Проверьте ID аккаунта и код — код живёт 30 секунд, так что берите свежий. Если попыток было много, подождите 15 минут или используйте резервный код.'
      : 'That did not work. Check the account id and the code — a code lives 30 seconds, so take a fresh one. After many attempts, wait 15 minutes or use a backup code.';
  }
  if (code === 'rate_limited') return ru ? 'Слишком много попыток. Подождите 15 минут.' : 'Too many attempts. Wait 15 minutes.';
  if (code === 'totp_unavailable') return ru ? 'Восстановление временно недоступно.' : 'Recovery is temporarily unavailable.';
  if (code === 'network') return ru ? 'Нет сети — попробуйте позже.' : 'Offline — try again later.';
  return ru ? 'Не удалось. Попробуйте ещё раз.' : 'Something went wrong. Try again.';
}

const codeOf = (e: unknown): string => (e instanceof ApiFailure ? e.code : 'error');

/**
 * The same failures, said differently when the user came in by name.
 *
 * Two things change. "Check the account id" is wrong advice for someone who does not have one. And a
 * throttle on a NAME is shared with everyone else who chose it, so the way out is not only waiting —
 * it is the id route, which has its own budget and is unaffected.
 */
function recoverErrorText(code: string, ru: boolean, byName: boolean): string {
  if (!byName) return errorText(code, ru);
  if (code === 'totp_invalid') {
    return ru
      ? 'Не подошло. Проверьте имя — оно должно совпадать с тем, что вы указали в настройках, — и возьмите свежий код: он живёт 30 секунд. Резервный код тоже подойдёт.'
      : 'That did not work. Check the name matches the one you set in settings, and take a fresh code — a code lives 30 seconds. A backup code works too.';
  }
  if (code === 'rate_limited') {
    return ru
      ? 'Слишком много попыток с этим именем — подождите 15 минут. Имя может быть не только вашим, поэтому счётчик общий; вход по ID аккаунта при этом работает.'
      : 'Too many attempts with this name — wait 15 minutes. A name can belong to more than one account, so the limit is shared; recovery by account id still works.';
  }
  return errorText(code, ru);
}

/**
 * Settings → the name that makes recovery possible without the account id.
 *
 * The id is derived from the recovery key, so it is gone in exactly the situation recovery is for. A
 * name is not a credential and unlocks nothing on its own — the authenticator still does all the
 * proving — which is why it can be something ordinary and memorable.
 */
function RecoveryNameField({ ru, initial }: { ru: boolean; initial: boolean }) {
  const [hasName, setHasName] = useState(initial);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await withToken((t) => setRecoveryName(t, name));
      setHasName(true);
      setEditing(false);
      setName('');
    } catch (e) {
      const code = codeOf(e);
      setError(
        code === 'recovery_name_crowded'
          ? ru
            ? 'Это имя уже заняли слишком многие. Возьмите другое — например, добавьте фамилию.'
            : 'Too many accounts already use that name. Pick another — adding a surname is enough.'
          : code === 'recovery_name_invalid'
            ? ru
              ? 'От 3 до 40 символов.'
              : 'Between 3 and 40 characters.'
            : errorText(code, ru)
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await withToken(clearRecoveryName);
      setHasName(false);
    } catch (e) {
      setError(errorText(codeOf(e), ru));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-2xs text-muted text-pretty">
        {hasName
          ? ru
            ? 'Имя для восстановления задано. По нему вместе с кодом из приложения можно вернуть аккаунт, не помня ID.'
            : 'A recovery name is set. With it and a code from the app you can get the account back without knowing the id.'
          : ru
            ? 'Можно задать имя для восстановления — что-то, что вы точно вспомните. Тогда ID помнить не нужно: имя плюс код из приложения. Имя ничего не открывает само по себе, и оно не обязано быть уникальным.'
            : 'You can set a recovery name — something you will certainly remember. Then the id is not needed: the name plus a code from the app. A name unlocks nothing on its own and does not have to be unique.'}
      </p>
      {/* Never shown back, because it cannot be: the server keeps only a keyed hash of it. */}
      {editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ru ? 'Например, Саша Петров' : 'For example, Alex Smith'}
            className="max-w-xs"
            autoComplete="off"
          />
          <Button size="sm" disabled={busy || name.trim().length < 3} onClick={() => void save()}>
            {ru ? 'Сохранить' : 'Save'}
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditing(false); setName(''); setError(null); }}>
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="ghost" onClick={() => { setEditing(true); setName(''); setError(null); }}>
            {hasName ? (ru ? 'Изменить имя' : 'Change the name') : ru ? 'Задать имя' : 'Set a name'}
          </Button>
          {hasName && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void remove()}>
              {ru ? 'Убрать' : 'Remove'}
            </Button>
          )}
        </div>
      )}
      {error && <p className="mt-2 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}

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

export function TotpEnroll({ ru, onNewKey }: { ru: boolean; onNewKey?: (composite: string) => void }) {
  const accountId = useAccount((s) => s.accountId);
  const [status, setStatus] = useState<TotpStatus | null>(null);
  /** The status call failed, as opposed to not having answered yet. The difference is the whole section
   *  appearing or not — see the render guard. */
  const [statusFailed, setStatusFailed] = useState(false);
  const [stage, setStage] = useState<'idle' | 'scanning' | 'codes' | 'disabling' | 'regenerating' | 'rotating'>('idle');
  const [enrollment, setEnrollment] = useState<{ secret: string; uri: string } | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  /** Six digits already sent by auto-submit. A failed confirm leaves `input` untouched, so without this
   *  the next render would send the same wrong code again — ten of those is a fifteen-minute lockout
   *  that blocks correct codes too. */
  const autoSent = useRef<string | null>(null);
  /** Auto-submit gives itself up for the session once the server has said "too many attempts". */
  const [autoOff, setAutoOff] = useState(false);
  const rotateRecoveryKey = useAccount((s) => s.rotateRecoveryKey);

  /** Answers are applied in start order, so a slow read cannot overwrite a newer one — and a response
   *  that arrives after the component is gone lands nowhere. */
  const statusGen = useRef(0);
  const loadStatus = useCallback(async () => {
    const gen = ++statusGen.current;
    try {
      const s = await withToken(totpStatus);
      if (gen === statusGen.current) {
        setStatus(s);
        setStatusFailed(false);
      }
    } catch {
      if (gen === statusGen.current) setStatusFailed(true);
    }
  }, []);

  /**
   * Read the status on mount, and again whenever the tab comes back to the foreground.
   *
   * The trip to the authenticator app is exactly the case where this tab's copy goes stale: the
   * enrollment may have been confirmed on a laptop, or cancelled in another tab, while we were away.
   * Asking the server is the only honest way to know, and `/status` is read-only — unlike `enroll`,
   * which MINTS a setup when none exists and so can never be used to ask this question.
   */
  useEffect(() => {
    void loadStatus();
    // Coming back to a backgrounded tab fires BOTH `visibilitychange` and `focus`, so without this one
    // return costs two authenticated reads. Only the listener path is coalesced: the calls made after an
    // action must still go, and they are ordered by the generation counter above.
    let rechecking = false;
    const recheck = () => {
      if (document.visibilityState !== 'visible' || rechecking) return;
      rechecking = true;
      void loadStatus().finally(() => {
        rechecking = false;
      });
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => {
      document.removeEventListener('visibilitychange', recheck);
      window.removeEventListener('focus', recheck);
    };
  }, [loadStatus]);

  /**
   * A scanning card on screen that the server no longer backs.
   *
   * Confirmed elsewhere, or cancelled elsewhere: either way the secret being shown can no longer be
   * confirmed, and the Confirm button under it could only answer 409. Say what happened rather than
   * letting the user discover it by failing.
   */
  useEffect(() => {
    // Never while a request of our own is outstanding. A `confirm` that has already committed on the
    // server but whose answer is still travelling would otherwise be read here as "someone else did
    // this", tearing down the card and leaving that line under the backup codes when it resolves.
    if (stage !== 'scanning' || !status || busy) return;
    if (!status.enrolled && status.pending) return;
    setStage('idle');
    setEnrollment(null);
    setInput('');
    setError(
      status.enrolled
        ? ru
          ? 'Приложение-аутентификатор уже подключено — подтверждение прошло, возможно на другом устройстве.'
          : 'An authenticator is already connected — the setup was confirmed, perhaps on another device.'
        : ru
          ? 'Это подключение было отменено. Начните заново, когда будете готовы.'
          : 'That setup was cancelled. Start again when you are ready.'
    );
  }, [status, stage, busy, ru]);

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
      try {
        const e = await withToken(totpEnroll);
        setEnrollment(e);
        setStage('scanning');
        setInput('');
        setCopied(false);
        autoSent.current = null;
        // Keep our copy of the server's answer honest: the row exists now, and the reconcile effect
        // above would otherwise read a stale `pending: false` as "cancelled elsewhere".
        setStatus((st) => (st ? { ...st, pending: true } : st));
      } catch (e) {
        // 409 means it was confirmed elsewhere between reading the status and pressing the button; 503
        // means the sealing key is gone. Retrying either can only repeat itself, and the generic
        // "try again" sends people to do exactly that — on a screen whose only button now always fails.
        const code = codeOf(e);
        if (code !== 'totp_already_enrolled' && code !== 'totp_unavailable') throw e;
        if (code === 'totp_already_enrolled') setStatus((s) => (s ? { ...s, enrolled: true, pending: false } : s));
        void loadStatus();
        setError(
          code === 'totp_already_enrolled'
            ? ru
              ? 'Приложение-аутентификатор уже подключено — видимо, на другом устройстве.'
              : 'An authenticator is already connected — on another device, most likely.'
            : ru
              ? 'Подключение временно недоступно. Попробуйте позже.'
              : 'Connecting an app is temporarily unavailable. Try again later.'
        );
      }
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
      let confirmedElsewhere = false;
      try {
        await withToken(totpCancel);
      } catch (e) {
        // 409 means the row is CONFIRMED — someone finished this very setup on another device while it
        // sat here. Swallowing it used to leave the screen insisting nothing was connected, offering a
        // button that could then answer nothing but 409.
        if (codeOf(e) !== 'totp_already_enrolled') throw e;
        confirmedElsewhere = true;
      }
      setStage('idle');
      setEnrollment(null);
      setInput('');
      setCopied(false);
      // Again patched first: if only the refetch spoke, a dropped answer would leave `pending` true and
      // the idle screen would offer to continue a setup that no longer exists — pressing it MINTS a new
      // secret, right after telling the user they need not re-scan. Every code from their stale entry is
      // then a failure counted against the ten.
      setStatus((s) => (s ? { ...s, pending: false, enrolled: s.enrolled || confirmedElsewhere } : s));
      void loadStatus();
      if (confirmedElsewhere) {
        setError(
          ru
            ? 'Отменять нечего: подключение уже подтверждено на другом устройстве.'
            : 'Nothing to cancel: the setup was already confirmed on another device.'
        );
      }
    });

  /** `value` is explicit for the auto-submit caller: it runs from inside `onChange`, where `input`
   *  still holds the PREVIOUS render's value — reading the state there sends five digits, which can
   *  only fail and still costs one of the ten attempts. */
  const confirm = (value?: string) =>
    run(async () => {
      const code = (value ?? input).trim();
      try {
        const codes = await totpConfirm(await accessToken(), code);
        setBackupCodes(codes);
        setEnrollment(null); // the secret must not linger in memory once it is live
        setStage('codes');
        setInput('');
        setStatus((s) => (s ? { ...s, enrolled: true, pending: false, backupCodesLeft: codes.length } : s));
      } catch (e) {
        // The server turned the authenticator on and the answer was lost; the codes it minted went with
        // it, shown once and stored as hashes. So ask for a fresh set — but NOT with the code just
        // typed: `confirm` records it as spent (`lastStep`), so replaying it fails as a wrong code AND
        // burns one of the ten attempts before a fifteen-minute lockout that blocks correct codes too.
        // A throttle means the next automatic send would be refused too, and each refusal is another
        // fifteen minutes. Hand the decision back to the user.
        if (codeOf(e) === 'rate_limited') setAutoOff(true);
        if (codeOf(e) !== 'totp_already_enrolled') throw e;
        setEnrollment(null);
        setInput('');
        setStage('regenerating');
        // Patched first and refetched only as confirmation. This IS the "the answer was lost" path, so
        // the next call is likely to be lost too — and leaning on it alone renders the NOT-enrolled
        // branch, which has no code field at all: a live authenticator, no backup codes, an instruction
        // to enter a code, and nothing to enter it into.
        setStatus((s) => (s ? { ...s, enrolled: true, pending: false } : s));
        void loadStatus();
        setError(
          ru
            ? 'Приложение уже подключено — похоже, ответ на подтверждение потерялся. Резервные коды показываются один раз, поэтому выпустим новые: дождитесь СЛЕДУЮЩЕГО кода в приложении и введите его.'
            : 'The app is already connected — the confirmation answer seems to have been lost. Backup codes are shown only once, so we will issue a fresh set: wait for the NEXT code in the app and enter it.'
        );
      }
    });

  /**
   * A new recovery key without signing out.
   *
   * The only route to one used to be the lost-key flow, which is signed out and burns every session.
   * That is right when a key may have been stolen and wrong for the two cases this serves: replacing a
   * key you think somebody saw, and getting a first key at all — device-linked and migrated users have
   * never been shown one.
   */
  const rotate = () =>
    run(async () => {
      const composite = await rotateRecoveryKey(input.trim(), signOutOthers);
      setStage('idle');
      setInput('');
      onNewKey?.(composite);
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
      // Merged, not replaced: a literal drops `recoveryName` and `recoverFailures`, and the recovery-name
      // field reads its initial value from the first — so replacing it here made a set name look unset.
      setStatus((s) => (s ? { ...s, enrolled: false, pending: false, backupCodesLeft: 0 } : s));
      setStage('idle');
      setInput('');
    });

  // Silence is right for "the server has no sealing key" — a button that can only 503 is worse than
  // nothing — and for the moment before the first answer arrives. It is NOT right for a FAILED call:
  // the section simply vanishing is how someone returning from their authenticator app on a bad
  // connection finds the recovery settings gone, with nothing to press and nothing to read.
  if (!status) {
    if (!statusFailed) return null;
    return (
      <div className="mt-6 border-t border-line pt-5">
        <h3 className="mb-1 text-sm font-bold">{ru ? 'Запасной вход' : 'Backup sign-in'}</h3>
        <p className="mb-2 text-2xs text-muted text-pretty">
          {ru
            ? 'Не удалось получить настройки запасного входа — похоже, нет связи. Данные на устройстве в порядке.'
            : 'Could not load the backup sign-in settings — the connection looks down. Nothing on this device is affected.'}
        </p>
        <Button size="sm" variant="ghost" onClick={() => void loadStatus()}>
          {ru ? 'Повторить' : 'Retry'}
        </Button>
      </div>
    );
  }
  if (!status.available) return null;

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
          {accountId && (
            <p className="mb-3 text-2xs leading-relaxed text-muted text-pretty">
              {ru ? 'Сохраните рядом и ID аккаунта — ' : 'Save your account id alongside them — '}
              <span className="select-all break-all font-mono text-content">{accountId}</span>
              {ru
                ? '. Восстановление спрашивает и то, и другое.'
                : '. Recovery asks for both.'}
            </p>
          )}
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
              setStatus((s) => (s ? { ...s, enrolled: true, pending: false, backupCodesLeft: backupCodes.length } : s));
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

          {accountId && (
            <p className="mb-4 rounded-sm border border-line bg-surface-2/40 px-3 py-2 text-2xs leading-relaxed text-muted text-pretty">
              {ru ? 'Если добавляете ключ вручную, назовите запись этим ID:' : 'Adding the key by hand? Name the entry with this id:'}{' '}
              <span className="select-all break-all font-mono text-content">{accountId}</span>{' '}
              {ru
                ? '— именно его спросят при восстановлении, если ключ потеряется.'
                : '— it is what recovery asks for if the key is ever lost.'}
            </p>
          )}
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
              onChange={(e) => {
                // Digits only, capped at six. The field used to accept anything: an `one-time-code`
                // autofill of the wrong thing, or a pasted label, spent one of ten attempts.
                const v = e.target.value.replace(/\D/g, '').slice(0, 6);
                setInput(v);
                // Submit as soon as six digits exist — the code is held in short-term memory and the
                // less there is to do with it, the better. Only from a real edit (typing, a paste, an
                // autofill), never from a re-render, and never twice for the same value: a failed
                // confirm leaves `input` alone, so resending would walk straight into the lockout.
                if (v.length === 6 && !busy && !autoOff && autoSent.current !== v) {
                  autoSent.current = v;
                  void confirm(v);
                }
              }}
              placeholder={ru ? '6 цифр' : '6 digits'}
              inputMode="numeric"
              autoComplete="one-time-code"
              className="max-w-[9rem] font-mono"
              spellCheck={false}
            />
            <Button size="sm" disabled={busy || !/^\d{6}$/.test(input)} onClick={() => void confirm()}>
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
          {/* Failed recovery attempts come from someone who is NOT signed in — never from this screen.
              Until the counters were split, the owner noticed an attack only by their own operations
              suddenly answering "too many attempts"; separating the budgets removed that symptom, so the
              count is shown instead. Nothing here is actionable, and saying so is the point: the account
              is not at risk, and a backup code still works. */}
          {(status.recoverFailures ?? 0) > 0 && (
            <p className="mb-1 text-2xs text-amber text-pretty">
              {ru
                ? `Неудачных попыток восстановления за последние 15 минут: ${status.recoverFailures}. Их делает кто-то, кто не вошёл в аккаунт. Подобрать код так нельзя, а вам резервный код по-прежнему подходит.`
                : `Failed recovery attempts in the last 15 minutes: ${status.recoverFailures}. They come from someone who is not signed in. A code cannot be guessed this way, and your backup codes still work.`}
            </p>
          )}
          {stage === 'rotating' ? (
            <div className="mt-2">
              <p className="mb-2 text-2xs leading-relaxed text-muted text-pretty">
                {ru
                  ? 'Введите код из приложения. Старый ключ перестанет работать сразу, новый мы покажем один раз. ID аккаунта не меняется — подписка, книги и прогресс остаются на месте.'
                  : 'Enter a code from the app. The old key stops working at once and the new one is shown only once. The account id does not change, so the subscription, books and progress stay where they are.'}
              </p>
              <label className="mb-2 flex items-start gap-2 text-2xs text-muted text-pretty">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={signOutOthers}
                  onChange={(e) => setSignOutOthers(e.target.checked)}
                />
                {/* On by default: someone rotating because a key was seen is rotating against a person who
                    may already hold a live session, and a session renews itself indefinitely. Off is the
                    right answer only for the user who never had a key to leak. */}
                <span>
                  {ru
                    ? 'Выйти на остальных устройствах — оставьте включённым, если ключ мог попасть к кому-то ещё.'
                    : 'Sign out other devices — leave this on if the key may have been seen by someone else.'}
                </span>
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={ru ? '6 цифр из приложения' : '6 digits from the app'}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  className="max-w-[12rem] font-mono"
                  spellCheck={false}
                />
                <Button size="sm" disabled={busy || input.trim().length < 6} onClick={() => void rotate()}>
                  {ru ? 'Выпустить ключ' : 'Issue a key'}
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setStage('idle'); setInput(''); }}>
                  {ru ? 'Отмена' : 'Cancel'}
                </Button>
              </div>
            </div>
          ) : stage === 'regenerating' ? (
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
              <Button size="sm" variant="ghost" onClick={() => { setStage('rotating'); setInput(''); }}>
                {ru ? 'Новый ключ восстановления' : 'New recovery key'}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => { setStage('disabling'); setInput(''); }}>
                {ru ? 'Отключить' : 'Disable'}
              </Button>
            </div>
          )}
          <RecoveryNameField ru={ru} initial={status.recoveryName ?? false} />
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

/**
 * Signed-out: the path for someone whose key is gone but whose authenticator still works.
 *
 * Two ways in, and the name comes first deliberately. The account id is the stronger address — it names
 * exactly one account and carries its own attempt budget — but it is derived from the recovery key, so
 * the people who need this screen are usually the ones who no longer have it. The id route stays one
 * click away, and the name route's own error copy points back at it.
 */
export function TotpRecover({ ru, onRecovered }: { ru: boolean; onRecovered: (composite: string) => void }) {
  const recoverWithTotp = useAccount((s) => s.recoverWithTotp);
  const recoverWithName = useAccount((s) => s.recoverWithName);
  const busy = useAccount((s) => s.busy);
  const [byName, setByName] = useState(true);
  const [accountId, setAccountId] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  /** Kept across a lost response — and across a reload, since a dropped connection and a closed tab are
   *  the same minute. The server may already hold this key, and generating a second one would guarantee
   *  that at most one of the two is the real credential. */
  const [pendingKey, setPendingKey] = useState<string | null>(() => pendingRecoveryKey());

  const ready = code.trim().length >= 6 && (byName ? name.trim().length >= 3 : accountId.trim().length >= 16);

  const submit = async () => {
    setError(null);
    try {
      const composite = byName
        ? await recoverWithName(name, code, pendingKey ?? undefined)
        : await recoverWithTotp(accountId, code);
      setPendingKey(null);
      onRecovered(composite);
    } catch (e) {
      if (e instanceof PendingRecovery) {
        setPendingKey(e.key);
        setCode('');
        return;
      }
      setError(recoverErrorText(codeOf(e), ru, byName));
    }
  };

  return (
    <div className="mt-3">
      <p className="mb-2 text-sm text-muted text-pretty">
        {byName
          ? ru
            ? 'Введите имя для восстановления, которое вы задали в настройках, и текущий код из приложения-аутентификатора. Подойдёт и резервный код вместо шестизначного.'
            : 'Enter the recovery name you set in settings and the current code from your authenticator app. A backup code works instead of the six digits.'
          : ru
            ? 'Откройте приложение-аутентификатор. Под названием DayEnglish указан ваш ID — впишите его сюда вместе с текущим кодом. Подойдёт и резервный код вместо шестизначного.'
            : 'Open your authenticator app. Your ID is shown under the DayEnglish entry — enter it here along with the current code. A backup code works instead of the six digits.'}
      </p>
      <div className="flex flex-col gap-2 sm:max-w-md">
        {byName ? (
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={ru ? 'Имя для восстановления' : 'Recovery name'}
            autoComplete="off"
          />
        ) : (
          <Input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="ID"
            className="font-mono"
            autoComplete="off"
            spellCheck={false}
          />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={ru ? 'Код' : 'Code'}
            autoComplete="one-time-code"
            className="max-w-[11rem] font-mono"
            spellCheck={false}
          />
          <Button size="sm" disabled={busy || !ready} onClick={() => void submit()}>
            {ru ? 'Восстановить' : 'Recover'}
          </Button>
        </div>
      </div>
      {/* Rendered from the pending key rather than from an error, so it survives the reload the error
          would not: an unfinished recovery has to say so even to someone arriving fresh. */}
      {pendingKey && (
        <p className="mt-2 text-2xs text-amber text-pretty">
          {ru
            ? 'Прошлая попытка оборвалась на полпути, и мы не знаем, применилась ли она. Возьмите новый код и нажмите ещё раз — ключ тот же, повтор безопасен.'
            : 'A previous attempt was cut off and we cannot tell whether it landed. Take a fresh code and press again — the key is the same one, so a retry is safe.'}
        </p>
      )}
      {/* The other door. It has to stay reachable from here: a name is shared, so its attempt budget can
          be spent by a stranger, and the id route is what is left when that happens. */}
      <Button
        size="sm"
        variant="ghost"
        className="mt-2 px-0"
        disabled={busy || !!pendingKey}
        onClick={() => { setByName(!byName); setError(null); }}
      >
        {byName
          ? ru
            ? 'У меня есть ID аккаунта'
            : 'I have my account id'
          : ru
            ? 'Я задавал имя для восстановления'
            : 'I set a recovery name'}
      </Button>
      {error && <p className="mt-2 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}
