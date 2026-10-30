import { useState } from 'react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { recoveryFileBody } from './recoveryFile';
import { captureAccountSessionOwner, useAccount } from './store';

export function SaveRecoveryKey({ recoveryKey, accountId, onContinue }: {
  recoveryKey: string; accountId: string | null; onContinue: () => void;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const [saved, setSaved] = useState(false);
  const [notice, setNotice] = useState('');
  const owns = captureAccountSessionOwner();
  const current = () => owns() && useAccount.getState().pendingRecoveryKey === recoveryKey;
  const copy = async () => {
    if (!current()) return;
    try {
      if (!navigator.clipboard) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(recoveryKey);
      setNotice(ru ? 'Ключ скопирован. Сохраните его в надёжном месте.' : 'Key copied. Keep it somewhere safe.');
    } catch {
      setNotice(ru ? 'Не удалось скопировать. Выделите ключ вручную или скачайте файл.' : 'Could not copy. Select the key manually or download the file.');
    }
  };
  const download = () => {
    if (!current()) return;
    const url = URL.createObjectURL(new Blob([recoveryFileBody(recoveryKey, accountId, ru)], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'dayenglish-recovery-key.txt'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(ru ? 'Проверьте, что файл сохранился и открывается.' : 'Check that the file was saved and opens.');
  };
  return <div className="space-y-4">
    <p className="text-sm leading-relaxed text-muted">{ru
      ? 'Это ваш пароль для входа на другом устройстве. Скопируйте ключ или скачайте файл и храните его в надёжном месте.'
      : 'This is your password for signing in on another device. Copy the key or download the file, and keep it somewhere safe.'}</p>
    <p data-recovery-key className="select-all break-all rounded-sm border border-teal-dim bg-ink p-4 font-mono text-sm text-teal">{recoveryKey}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="ghost" className="min-h-11" onClick={() => void copy()}>{ru ? 'Скопировать' : 'Copy key'}</Button>
      <Button variant="ghost" className="min-h-11" onClick={download}>{ru ? 'Скачать .txt' : 'Download .txt'}</Button>
    </div>
    <p role="status" className="text-xs text-muted">{notice}</p>
    <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
      <input className="mt-1.5 h-5 w-5 shrink-0 accent-teal" type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
      {ru ? 'Я сохранил(а) ключ в надёжном месте' : 'I have saved the key somewhere safe'}
    </label>
    <Button className="min-h-12 w-full" disabled={!saved} onClick={() => { if (current()) onContinue(); }}>{ru ? 'К пробному периоду' : 'Continue to trial'}</Button>
  </div>;
}
