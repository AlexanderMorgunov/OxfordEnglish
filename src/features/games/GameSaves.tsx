import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { useAccount } from '@/features/account/store';
import { subscribeDataScope } from '@/features/account/dataScope';
import { useUiLang } from '@/features/i18n/uiLang';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { GameFailure } from './contract';
import type { GameManifest } from './contract';
import { gameScope, loadSave, swapBackupSave } from './storage';
import type { SavedGame } from './storage';
import { syncSave } from './api';
import { GameCloudDialog } from './GameCloudDialog';

export function GameSaves({
  game,
  onClose,
}: {
  game: GameManifest;
  onClose: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const t = (r: string, e: string) => (ru ? r : e);
  const [scope] = useState(gameScope);
  const controller = useRef(new AbortController());
  const [saves, setSaves] = useState<(SavedGame | null)[] | null>(null);
  const [error, setError] = useState('');
  const [readError, setReadError] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [backup, setBackup] = useState('');
  const lock = useRef(false);
  const accountId = useAccount((s) => s.accountId);
  useEffect(() => {
    controller.current = new AbortController();
    const query = liveQuery(() =>
      db.transaction('r', db.gameRecords, () =>
        Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            loadSave(scope, game.gameId, String(i))
          )
        )
      )
    ).subscribe({
      next: setSaves,
      error: () => setReadError(true),
    });
    const close = () => {
      controller.current.abort();
      onClose();
    };
    const unsubscribe = subscribeDataScope(close);
    const account = useAccount.subscribe((s, p) => {
      if (
        s.accountId !== p.accountId ||
        s.sessionRevision !== p.sessionRevision ||
        s.status !== p.status
      )
        close();
    });
    return () => {
      controller.current.abort();
      query.unsubscribe();
      unsubscribe();
      account();
    };
  }, [game.gameId, onClose, scope]);
  const run = async (action: 'push' | 'pull' | 'backup') => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError('');
    setMessage('');
    const signal = controller.current.signal;
    try {
      const result =
        action === 'backup'
          ? await swapBackupSave(scope, game.gameId, backup)
          : await syncSave(scope, game.gameId, '0', action);
      scope.check();
      if (!signal.aborted)
        setMessage(
          result.status === 'empty'
            ? t('Сохранение не найдено.', 'No save found.')
            : action === 'backup'
              ? t(
                  'Копия выбрана. Прежнее сохранение осталось в резервном слоте.',
                  'Backup selected. The previous save is kept in the backup slot.'
                )
              : action === 'push'
                ? t('Копия отправлена в облако.', 'Copy uploaded.')
                : t(
                    'Облачная копия загружена на устройство.',
                    'Cloud copy downloaded.'
                  )
        );
    } catch (e) {
      if (signal.aborted) return;
      if (e instanceof GameFailure && e.code === 'conflict') setConflict(true);
      else
        setError(
          e instanceof GameFailure && e.code === 'no_plan'
            ? t(
                'Запись в облако доступна с Pro или триалом. Прежнюю облачную копию можно загрузить и без подписки.',
                'Uploading requires Pro or a trial. Existing cloud saves can still be downloaded without a subscription.'
              )
            : t(
                'Не удалось завершить действие. Сохранения не удалены. Проверьте соединение и повторите.',
                'Could not finish. Saves have not been deleted. Check your connection and retry.'
              )
        );
    } finally {
      lock.current = false;
      if (!signal.aborted) setBusy(false);
    }
  };
  if (conflict)
    return (
      <GameCloudDialog
        scope={scope}
        gameId={game.gameId}
        slotId="0"
        signal={controller.current.signal}
        finish={() => {
          setConflict(false);
          setMessage(
            t(
              'Проверьте сохранение перед следующим запуском. Резервные копии доступны ниже.',
              'Check the save before launching. Backups are available below.'
            )
          );
        }}
      />
    );
  return (
    <Dialog
      title={t('Мои сохранения', 'My saves')}
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <Button variant="ghost" disabled={busy} onClick={onClose}>
          {t('Закрыть', 'Close')}
        </Button>
      }
    >
      <p>
        {readError
          ? t('Не удалось прочитать сохранения.', 'Could not read saves.')
          : saves === null
            ? t('Проверяем устройство…', 'Checking this device…')
            : saves[0]
              ? t(
                  'Есть контрольная точка на этом устройстве.',
                  'A checkpoint is available on this device.'
                )
              : t(
                  'Игра ещё не сохранила контрольную точку.',
                  'The game has not saved a checkpoint yet.'
                )}
      </p>
      {accountId ? (
        <div className="games-actions">
          <Button
            disabled={busy || !saves?.[0]}
            onClick={() => void run('push')}
          >
            {t('Сохранить в облако', 'Upload to cloud')}
          </Button>
          <Button
            variant="ghost"
            disabled={busy || !saves}
            onClick={() => void run('pull')}
          >
            {t('Загрузить из облака', 'Download from cloud')}
          </Button>
        </div>
      ) : (
        <p>
          {t(
            'Сохранение доступно на этом устройстве. Для облака нужен аккаунт; для записи — Pro или триал.',
            'Saves are local. Cloud access requires an account; uploading requires Pro or a trial.'
          )}{' '}
          <Link to="/account/login" onClick={onClose}>
            {t('Войти', 'Sign in')}
          </Link>
        </p>
      )}
      {saves?.some((save, i) => i > 0 && save) && (
        <section>
          <label className="game-field">
            {t('Резервная копия', 'Backup')}
            <select
              value={backup}
              disabled={busy}
              onChange={(e) => setBackup(e.target.value)}
            >
              <option value="">{t('Выберите копию', 'Select a backup')}</option>
              {saves.map((save, i) =>
                i > 0 && save ? (
                  <option key={i} value={i}>
                    {t('Слот', 'Slot')} {i}
                  </option>
                ) : null
              )}
            </select>
          </label>
          <p>
            {t(
              'Выбранная копия и текущее сохранение поменяются местами. Обе версии останутся на устройстве.',
              'The selected backup and current save will swap places. Both remain on this device.'
            )}
          </p>
          <Button disabled={busy || !backup} onClick={() => void run('backup')}>
            {t('Использовать копию', 'Use backup')}
          </Button>
        </section>
      )}
      {busy && <p role="status">{t('Подождите…', 'Please wait…')}</p>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
