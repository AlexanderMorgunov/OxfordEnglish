import { useEffect, useState } from 'react';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  readCloudConflict,
  resolveCloudConflict,
  type CloudConflict,
} from './api';
import type { GameScope } from './storage';

export function GameCloudDialog({
  scope,
  gameId,
  slotId,
  signal,
  finish,
}: {
  scope: GameScope;
  gameId: string;
  slotId: string;
  signal: AbortSignal;
  finish: (value: unknown) => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [snapshot, setSnapshot] = useState<CloudConflict | null>(null);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void readCloudConflict(scope, gameId, slotId).then(
      (value) => {
        if (live && !signal.aborted) setSnapshot(value);
      },
      () => {
        if (live) setError(true);
      }
    );
    return () => {
      live = false;
    };
  }, [scope, gameId, slotId, signal]);
  const choose = async (choice: 'local' | 'cloud') => {
    if (!snapshot || signal.aborted) return;
    setBusy(true);
    setError(false);
    try {
      const result = await resolveCloudConflict(
        scope,
        gameId,
        slotId,
        snapshot,
        choice
      );
      if (!signal.aborted) finish(result);
    } catch {
      setSnapshot(null);
      setError(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={ru ? 'Выберите сохранение' : 'Choose a save'}
      onClose={() => {
        if (!busy) finish({ status: 'cancelled' });
      }}
      footer={
        <>
          <Button
            disabled={!snapshot || busy}
            onClick={() => void choose('local')}
          >
            {ru ? 'С этого устройства' : 'Use this device'}
          </Button>
          <Button
            disabled={!snapshot || busy}
            onClick={() => void choose('cloud')}
          >
            {ru ? 'Из облака' : 'Use cloud'}
          </Button>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => finish({ status: 'cancelled' })}
          >
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
        </>
      }
    >
      <p>
        {ru
          ? 'Две версии отличаются. Перед заменой сохраним вторую версию в свободный локальный слот. Если свободного слота нет, замена не произойдёт.'
          : 'The versions differ. The other version will be kept in an unused local slot before replacement. Without a free slot nothing is replaced.'}
      </p>
      {snapshot && (
        <p>
          {ru ? 'Версии: устройство / облако' : 'Revisions: device / cloud'} —{' '}
          {snapshot.local.revision} / {snapshot.remote.revision}
        </p>
      )}
      {error && (
        <p role="alert">
          {ru
            ? 'Не удалось завершить. Закройте окно и проверьте сохранения ещё раз. Исходные данные сохранены.'
            : 'Could not finish. Close and inspect the saves again. Original data is preserved.'}
        </p>
      )}
    </Dialog>
  );
}
