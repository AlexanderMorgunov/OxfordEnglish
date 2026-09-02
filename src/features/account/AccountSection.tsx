import { useEffect, useRef, useState } from 'react';
import { Button, Card, Eyebrow, Input } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { accountsEnabled } from './config';
import { useAccount } from './store';
import type { Device, DeviceStartResponse } from './contract';

/** Settings → Account. Absent entirely when no backend is configured (`accountsEnabled()` false), so
 *  prod/staging without an API is clean. Slice 1: create / save recovery key / link by key / link a
 *  second device by approval / per-device revoke / status / logout. TOTP recovery arrives later. */
export function AccountSection() {
  if (!accountsEnabled()) return null;
  return <AccountSectionBody />;
}

function AccountSectionBody() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const status = useAccount((s) => s.status);
  const accountId = useAccount((s) => s.accountId);
  const deviceId = useAccount((s) => s.deviceId);
  const busy = useAccount((s) => s.busy);
  const error = useAccount((s) => s.error);
  const createAccount = useAccount((s) => s.createAccount);
  const linkWithKey = useAccount((s) => s.linkWithKey);
  const logout = useAccount((s) => s.logout);

  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [confirmedSaved, setConfirmedSaved] = useState(false);
  const [showLink, setShowLink] = useState(false);
  const [keyInput, setKeyInput] = useState('');
  const [showDeviceLink, setShowDeviceLink] = useState(false);

  const errText = error
    ? error === 'invalid_credentials'
      ? ru
        ? 'Неверный ключ восстановления.'
        : 'Wrong recovery key.'
      : error === 'network'
        ? ru
          ? 'Нет сети — попробуйте позже.'
          : 'Offline — try again later.'
        : ru
          ? 'Не удалось. Попробуйте ещё раз.'
          : 'Something went wrong. Try again.'
    : null;

  const onCreate = async () => {
    try {
      const key = await createAccount();
      setSavedKey(key);
      setConfirmedSaved(false);
    } catch {
      // error surfaced via store.error
    }
  };

  const onLink = async () => {
    try {
      await linkWithKey(keyInput);
      setShowLink(false);
      setKeyInput('');
    } catch {
      // error surfaced via store.error
    }
  };

  const copyKey = () => savedKey && void navigator.clipboard?.writeText(savedKey).catch(() => undefined);
  const downloadKey = () => {
    if (!savedKey) return;
    const blob = new Blob([`DayEnglish recovery key\n\n${savedKey}\n`], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'dayenglish-recovery-key.txt';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mb-10 border-b border-line pb-8">
      <Eyebrow className="mb-3.5">config · account</Eyebrow>
      <h2 className="mb-2 text-2xl font-bold tracking-tight">{ru ? 'Аккаунт' : 'Account'}</h2>

      {/* Save-your-key screen, shown once right after creating an account. */}
      {savedKey ? (
        <Card className="border-amber-dim bg-amber-dim/15">
          <p className="mb-2 text-sm text-content">
            {ru
              ? 'Это ваш ключ восстановления. Сохраните его — без него доступ к облачной копии не восстановить. Мы его не храним.'
              : 'This is your recovery key. Save it — it is the only way back to your cloud copy, and we do not store it.'}
          </p>
          <p className="mb-3 select-all break-all rounded-sm bg-surface px-3 py-2 font-mono text-base text-teal">
            {savedKey}
          </p>
          <div className="mb-3 flex flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={copyKey}>
              {ru ? 'Скопировать' : 'Copy'}
            </Button>
            <Button size="sm" variant="ghost" onClick={downloadKey}>
              {ru ? 'Скачать .txt' : 'Download .txt'}
            </Button>
          </div>
          <label className="mb-3 flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={confirmedSaved} onChange={(e) => setConfirmedSaved(e.target.checked)} />
            {ru ? 'Я сохранил(а) ключ в надёжном месте' : 'I have saved the key somewhere safe'}
          </label>
          <Button size="sm" disabled={!confirmedSaved} onClick={() => setSavedKey(null)}>
            {ru ? 'Готово' : 'Done'}
          </Button>
        </Card>
      ) : status === 'authenticated' ? (
        <div>
          <p className="mb-1 text-sm text-content">
            {ru ? 'Вы вошли. Прогресс будет синхронизироваться между устройствами.' : 'Signed in. Your progress will sync across devices.'}
          </p>
          <p className="mb-3 font-mono text-2xs text-muted">
            id: {accountId?.slice(0, 10)}… · {ru ? 'это устройство' : 'this device'}: {deviceId.slice(0, 8)}
          </p>
          <Button size="sm" variant="ghost" onClick={() => void logout()}>
            {ru ? 'Выйти' : 'Log out'}
          </Button>
          <DeviceManager ru={ru} thisDeviceId={deviceId} />
        </div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-muted text-pretty">
            {ru
              ? 'Вход не обязателен — всё работает и хранится на этом устройстве. Войдите, чтобы заниматься на нескольких устройствах: прогресс, словарь и книги будут синхронизироваться, и появится резервная копия. Без email — только ключ восстановления.'
              : 'You don’t need an account — everything works and stays on this device. Sign in to study on several devices: progress, vocabulary and books sync, with a cloud backup. No email — just a recovery key.'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void onCreate()}>
              {ru ? 'Создать аккаунт' : 'Create account'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowLink((v) => !v)}>
              {ru ? 'У меня есть ключ' : 'I have a key'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setShowDeviceLink((v) => !v)}>
              {ru ? 'Уже вошли на другом устройстве?' : 'Already signed in elsewhere?'}
            </Button>
          </div>
          {showLink && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Input
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder={ru ? 'Ключ восстановления' : 'Recovery key'}
                className="max-w-xs font-mono"
                autoComplete="off"
                spellCheck={false}
              />
              <Button size="sm" disabled={busy || keyInput.trim().length < 8} onClick={() => void onLink()}>
                {ru ? 'Войти' : 'Sign in'}
              </Button>
            </div>
          )}
          {showDeviceLink && <DeviceLinkNew ru={ru} />}
        </div>
      )}

      {errText && <p className="mt-3 font-mono text-2xs text-coral">{errText}</p>}
    </div>
  );
}

/** New (signed-out) device: get a short code, show it, and poll until the already-signed-in device
 *  approves it. On approval the store adopts the session and this component's parent re-renders as
 *  authenticated. The code is high-entropy + short-lived (60 s) — no QR needed. */
function DeviceLinkNew({ ru }: { ru: boolean }) {
  const startDeviceLink = useAccount((s) => s.startDeviceLink);
  const pollDeviceLink = useAccount((s) => s.pollDeviceLink);

  const [req, setReq] = useState<DeviceStartResponse | null>(null);
  const [state, setState] = useState<'idle' | 'waiting' | 'expired' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const start = async () => {
    if (timer.current) clearInterval(timer.current);
    setState('waiting');
    try {
      const r = await startDeviceLink();
      setReq(r);
      timer.current = setInterval(() => {
        void pollDeviceLink(r.requestId)
          .then((status) => {
            if (status === 'approved') {
              if (timer.current) clearInterval(timer.current);
              // parent flips to the authenticated view
            } else if (status === 'expired') {
              if (timer.current) clearInterval(timer.current);
              setState('expired');
            }
          })
          .catch(() => undefined);
      }, 2500);
    } catch {
      setState('error');
    }
  };

  return (
    <Card className="mt-3">
      <p className="mb-2 text-sm text-content">
        {ru
          ? 'На устройстве, где вы уже вошли, откройте Настройки → Аккаунт → «Одобрить устройство» и введите этот код:'
          : 'On the device where you are already signed in, open Settings → Account → “Approve a device” and enter this code:'}
      </p>
      {req ? (
        <>
          <p className="mb-2 select-all rounded-sm bg-surface px-3 py-2 text-center font-mono text-xl tracking-widest text-teal">
            {req.code}
          </p>
          <p className="text-2xs text-muted">
            {state === 'expired'
              ? ru
                ? 'Код истёк. Обновите и попробуйте снова.'
                : 'Code expired. Refresh and try again.'
              : ru
                ? 'Ждём одобрения… Код действует около минуты.'
                : 'Waiting for approval… The code lasts about a minute.'}
          </p>
          {state === 'expired' && (
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => void start()}>
              {ru ? 'Новый код' : 'New code'}
            </Button>
          )}
        </>
      ) : (
        <Button size="sm" disabled={state === 'waiting'} onClick={() => void start()}>
          {ru ? 'Получить код' : 'Get a code'}
        </Button>
      )}
      {state === 'error' && (
        <p className="mt-2 font-mono text-2xs text-coral">{ru ? 'Не удалось. Попробуйте ещё раз.' : 'Something went wrong. Try again.'}</p>
      )}
    </Card>
  );
}

/** Signed-in device: approve a pending code from a new device, and manage/revoke the device list. */
function DeviceManager({ ru, thisDeviceId }: { ru: boolean; thisDeviceId: string }) {
  const approveDevice = useAccount((s) => s.approveDevice);
  const listDevices = useAccount((s) => s.listDevices);
  const revokeDevice = useAccount((s) => s.revokeDevice);

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState('');
  const [approved, setApproved] = useState<string | null>(null);
  const [approveErr, setApproveErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devices, setDevices] = useState<Device[] | null>(null);

  const refreshList = () => {
    void listDevices()
      .then(setDevices)
      .catch(() => undefined);
  };

  useEffect(() => {
    if (open) refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onApprove = async () => {
    setBusy(true);
    setApproveErr(false);
    setApproved(null);
    try {
      const name = await approveDevice(code);
      setApproved(name ?? (ru ? 'новое устройство' : 'a new device'));
      setCode('');
      refreshList();
    } catch {
      setApproveErr(true);
    } finally {
      setBusy(false);
    }
  };

  const onRevoke = async (id: string) => {
    setBusy(true);
    try {
      await revokeDevice(id);
      refreshList();
    } catch {
      // ignore; list refresh will reflect reality
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button size="sm" variant="ghost" className="ml-2" onClick={() => setOpen(true)}>
        {ru ? 'Устройства' : 'Devices'}
      </Button>
    );
  }

  return (
    <Card className="mt-3">
      <p className="mb-2 text-sm font-semibold text-content">{ru ? 'Одобрить устройство' : 'Approve a device'}</p>
      <p className="mb-2 text-2xs text-muted text-pretty">
        {ru
          ? 'На новом устройстве нажмите «Уже вошли на другом устройстве?» и введите здесь показанный код.'
          : 'On the new device, tap “Already signed in elsewhere?” and enter the code it shows here.'}
      </p>
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={ru ? 'Код с нового устройства' : 'Code from the new device'}
          className="max-w-xs font-mono"
          autoComplete="off"
          spellCheck={false}
        />
        <Button size="sm" disabled={busy || code.trim().length < 8} onClick={() => void onApprove()}>
          {ru ? 'Одобрить' : 'Approve'}
        </Button>
      </div>
      {approved && (
        <p className="mb-2 font-mono text-2xs text-teal">
          {ru ? `Одобрено: ${approved}` : `Approved: ${approved}`}
        </p>
      )}
      {approveErr && (
        <p className="mb-2 font-mono text-2xs text-coral">{ru ? 'Неверный или истёкший код.' : 'Wrong or expired code.'}</p>
      )}

      <p className="mb-2 mt-4 text-sm font-semibold text-content">{ru ? 'Ваши устройства' : 'Your devices'}</p>
      {devices === null ? (
        <p className="text-2xs text-muted">{ru ? 'Загрузка…' : 'Loading…'}</p>
      ) : devices.length === 0 ? (
        <p className="text-2xs text-muted">{ru ? 'Нет устройств.' : 'No devices.'}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {devices.map((d) => {
            const isThis = d.deviceId === thisDeviceId;
            return (
              <li key={d.deviceId} className="flex items-center justify-between gap-2 text-sm">
                <span className="text-content">
                  {d.deviceName ?? (ru ? 'Устройство' : 'Device')}{' '}
                  <span className="font-mono text-2xs text-muted">{d.deviceId.slice(0, 8)}</span>
                  {isThis && <span className="ml-1 text-2xs text-teal">{ru ? '· это' : '· this'}</span>}
                </span>
                {!isThis && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onRevoke(d.deviceId)}>
                    {ru ? 'Отвязать' : 'Revoke'}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
