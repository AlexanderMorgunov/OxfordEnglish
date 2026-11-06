import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { useUiLang } from '@/features/i18n/uiLang';
import { RecoveryDraftContext } from './recovery-draft';
import { CaptureDraftContext } from '@/features/capture/draft';

export function RecoveryNavigationGuard({ children }: { children: ReactNode }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const [captures, setCaptures] = useState<Set<string>>(() => new Set());
  const updateCapture = useCallback((id: string, unsaved: boolean) => {
    setCaptures((previous) => {
      if (previous.has(id) === unsaved) return previous;
      const next = new Set(previous);
      if (unsaved) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const update = useCallback((id: string, unsaved: boolean) => {
    setDrafts((previous) => {
      if (previous.has(id) === unsaved) return previous;
      const next = new Set(previous);
      if (unsaved) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const blocker = useBlocker(drafts.size > 0 || captures.size > 0);
  useEffect(() => {
    if (!drafts.size && !captures.size && blocker.state === 'blocked')
      blocker.reset();
  }, [drafts.size, captures.size, blocker]);
  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };
  return (
    <RecoveryDraftContext value={update}>
      <CaptureDraftContext value={updateCapture}>
        {children}
        {blocker.state === 'blocked' && (
          <Dialog
            title={
              drafts.size
                ? ru
                  ? 'Сохраните резервные коды'
                  : 'Save your backup codes'
                : ru
                  ? 'Уйти без сохранения фразы?'
                  : 'Leave without saving the phrase?'
            }
            onClose={stay}
          >
            <p>
              {!drafts.size
                ? ru
                  ? 'Изменённый текст не сохранится. Можно остаться и добавить фразу в словарь.'
                  : 'Your edits have not been saved. Stay to add the phrase to your vocabulary.'
                : ru
                  ? 'Вы ещё не подтвердили сохранение кодов. После ухода они больше не будут показаны. Новый набор можно выпустить в аккаунте.'
                  : 'You have not confirmed saving these codes. They will not be shown after you leave. You can issue a new set in your account.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={stay}>
                {drafts.size
                  ? ru
                    ? 'Остаться и сохранить'
                    : 'Stay and save'
                  : ru
                    ? 'Продолжить редактирование'
                    : 'Keep editing'}
              </Button>
              <Button variant="ghost" onClick={() => blocker.proceed()}>
                {ru ? 'Уйти без сохранения' : 'Leave without saving'}
              </Button>
            </div>
          </Dialog>
        )}
      </CaptureDraftContext>
    </RecoveryDraftContext>
  );
}
