import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAccount } from '@/features/account/store';
import { captureDataScope } from '@/features/account/dataScope';
import {
  BookFileSyncToggle,
  SyncStatusLine,
} from '@/features/account/AccountSection';
import { exportData, importData } from '@/features/progress/backup';
import { applySnapshot } from '@/features/migration/snapshot';
import type { Snapshot } from '@/features/migration/snapshot';
import { triggerSync } from '@/features/sync/run';
import { useSyncStatus } from '@/features/sync/status';

export function DataSettings({
  accountHref,
  active,
}: {
  accountHref: string;
  active: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const signedIn = useAccount((s) => s.status) === 'authenticated';
  const session = useAccount((s) => s.sessionRevision);
  const phase = useSyncStatus((s) => s.phase);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{
    value: File;
    current: () => boolean;
  } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exportMessage, setExportMessage] = useState('');
  const [importMessage, setImportMessage] = useState('');
  const [imported, setImported] = useState(false);
  useEffect(() => {
    if (!active) setFile(null);
  }, [active]);
  const doExport = async () => {
    const current = captureDataScope();
    setExporting(true);
    setExportMessage('');
    try {
      const text = await exportData();
      if (!current()) return;
      const url = URL.createObjectURL(
        new Blob([text], { type: 'application/json' })
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = 'dayenglish-progress.json';
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setExportMessage(
        ru
          ? 'Файл подготовлен для скачивания.'
          : 'The file is ready to download.'
      );
    } catch {
      if (current())
        setExportMessage(
          ru
            ? 'Не удалось создать копию. Повторите экспорт.'
            : 'Could not create a backup. Retry the export.'
        );
    } finally {
      if (current()) setExporting(false);
    }
  };
  const doImport = async () => {
    if (!file?.current()) {
      setFile(null);
      return;
    }
    const { value, current } = file;
    setFile(null);
    setImporting(true);
    setImported(false);
    setImportMessage('');
    try {
      const text = await value.text();
      if (!current()) return;
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
        throw new Error('backup');
      if (
        'snapshotVersion' in parsed &&
        typeof parsed.snapshotVersion === 'number'
      )
        await applySnapshot(parsed as Snapshot);
      else {
        if (
          ![
            'attempts',
            'wordStatus',
            'srsCards',
            'checkpoints',
            'translations',
            'catalogCache',
            'bookmarks',
            'activity',
            'reviewLog',
            'readerTerms',
          ].some((key) => key in parsed)
        )
          throw new Error('backup');
        await importData(text);
      }
      if (!current()) return;
      setImported(true);
      setImportMessage(
        ru
          ? 'Данные импортированы. Обновите страницу, чтобы увидеть все изменения.'
          : 'Data imported. Reload the page to see all changes.'
      );
    } catch {
      if (current())
        setImportMessage(
          ru
            ? 'Импорт не завершён. Проверьте, что выбран файл резервной копии DayEnglish (.json), и повторите.'
            : 'Import did not finish. Choose a DayEnglish backup (.json) and retry.'
        );
    } finally {
      if (current()) setImporting(false);
    }
  };
  return (
    <>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <h3>
              {signedIn
                ? ru
                  ? 'Синхронизация'
                  : 'Sync'
                : ru
                  ? 'Хранится на этом устройстве'
                  : 'Stored on this device'}
            </h3>
            {signedIn ? (
              <SyncStatusLine ru={ru} />
            ) : (
              <p>
                {ru
                  ? 'Для синхронизации между устройствами нужен аккаунт и Pro или пробный период.'
                  : 'An account with Pro or a trial enables syncing across devices.'}
              </p>
            )}
            {signedIn ? (
              <Button
                variant="ghost"
                className="mt-3"
                disabled={phase === 'syncing'}
                onClick={() => void triggerSync()}
              >
                {ru ? 'Синхронизировать' : 'Sync now'}
              </Button>
            ) : (
              <Link className="settings-text-link" to={accountHref}>
                {ru ? 'Перейти к аккаунту →' : 'Go to account →'}
              </Link>
            )}
          </div>
        </div>
        {signedIn && (
          <div className="settings-row">
            <BookFileSyncToggle key={session} ru={ru} />
          </div>
        )}
      </div>
      <div className="settings-group">
        <h3 className="settings-group-title">
          {ru ? 'Резервная копия' : 'Backup'}
        </h3>
        <div className="settings-row">
          <div>
            <h3>{ru ? 'Сохранить данные себе' : 'Keep your own copy'}</h3>
            <p>
              {ru
                ? 'Прогресс, словарь, карточки повторения и закладки. Импортированные файлы книг в эту копию не входят — храните оригиналы отдельно.'
                : 'Progress, vocabulary, review cards and bookmarks. Imported book files are not included — keep the originals separately.'}
            </p>
            <p role="status" className="settings-feedback">
              {exportMessage}
            </p>
          </div>
          <Button
            variant="ghost"
            disabled={exporting || importing}
            onClick={() => void doExport()}
          >
            {exporting
              ? ru
                ? 'Подготовка…'
                : 'Preparing…'
              : ru
                ? 'Экспортировать'
                : 'Export'}
          </Button>
        </div>
        <div className="settings-row">
          <div>
            <h3>{ru ? 'Восстановить из копии' : 'Restore a backup'}</h3>
            <p>
              {ru
                ? 'Выберите файл JSON, который ранее скачали из DayEnglish.'
                : 'Choose a JSON backup previously downloaded from DayEnglish.'}
            </p>
            <p role="status" className="settings-feedback">
              {importMessage}
            </p>
            {imported && (
              <Button variant="ghost" onClick={() => window.location.reload()}>
                {ru ? 'Обновить страницу' : 'Reload page'}
              </Button>
            )}
          </div>
          <Button
            variant="ghost"
            disabled={importing || exporting}
            onClick={(e) => {
              e.currentTarget.focus();
              input.current?.click();
            }}
          >
            {importing
              ? ru
                ? 'Импорт…'
                : 'Importing…'
              : ru
                ? 'Импортировать'
                : 'Import'}
          </Button>
          <input
            ref={input}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const selected = e.target.files?.[0];
              e.target.value = '';
              if (selected)
                setFile({ value: selected, current: captureDataScope() });
            }}
          />
        </div>
      </div>
      {file && active && (
        <Dialog
          title={ru ? 'Импортировать данные?' : 'Import data?'}
          onClose={() => setFile(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setFile(null)}>
                {ru ? 'Отмена' : 'Cancel'}
              </Button>
              <Button onClick={() => void doImport()}>
                {ru ? 'Импортировать' : 'Import'}
              </Button>
            </>
          }
        >
          <p className="break-all text-sm">{file.value.name}</p>
          <p className="mt-3 text-sm text-muted">
            {ru
              ? 'Данные из копии объединятся с текущими. Совпадающие записи словаря и карточек могут обновиться. Перед импортом рекомендуем сохранить текущую копию.'
              : 'The backup will merge with current data. Matching vocabulary and review cards may be updated. Consider exporting a current backup first.'}
          </p>
        </Dialog>
      )}
    </>
  );
}
