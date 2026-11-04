import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useBlocker } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { useUiLang } from '@/features/i18n/uiLang';
import { RecoveryDraftContext } from './recovery-draft';

export function RecoveryNavigationGuard({ children }: { children: ReactNode }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [drafts, setDrafts] = useState<Set<string>>(() => new Set());
  const update = useCallback((id: string, unsaved: boolean) => {
    setDrafts((previous) => {
      if (previous.has(id) === unsaved) return previous;
      const next = new Set(previous);
      if (unsaved) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const blocker = useBlocker(drafts.size > 0);
  useEffect(() => {
    if (!drafts.size && blocker.state === 'blocked') blocker.reset();
  }, [drafts.size, blocker]);
  const stay = () => {
    if (blocker.state === 'blocked') blocker.reset();
  };
  return (
    <RecoveryDraftContext value={update}>
      {children}
      {blocker.state === 'blocked' && (
        <Dialog
          title={ru ? 'Сохраните резервные коды' : 'Save your backup codes'}
          onClose={stay}
        >
          <p>
            {ru
              ? 'Вы ещё не подтвердили сохранение кодов. После ухода они больше не будут показаны. Новый набор можно выпустить в аккаунте.'
              : 'You have not confirmed saving these codes. They will not be shown after you leave. You can issue a new set in your account.'}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={stay}>
              {ru ? 'Остаться и сохранить' : 'Stay and save'}
            </Button>
            <Button variant="ghost" onClick={() => blocker.proceed()}>
              {ru ? 'Уйти без сохранения' : 'Leave without saving'}
            </Button>
          </div>
        </Dialog>
      )}
    </RecoveryDraftContext>
  );
}
