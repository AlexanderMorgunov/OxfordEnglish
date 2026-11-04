import { useEffect } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useAccount } from './store';
import { planLine, subscriptionState } from './entitlement';
import { useSignupNotice } from './signupNotice';

export function AccountAccessNotice() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const revision = useAccount((s) => s.sessionRevision);
  const notice = useSignupNotice((s) => s.notice);
  const close = useSignupNotice((s) => s.close);
  useEffect(() => {
    const validate = () => {
      if (notice && !notice.owned()) close();
    };
    validate();
    const storage = (event: StorageEvent) => {
      if (event.key === 'oxford-account' || event.key === null) validate();
    };
    window.addEventListener('storage', storage);
    window.addEventListener('pageshow', validate);
    return () => {
      window.removeEventListener('storage', storage);
      window.removeEventListener('pageshow', validate);
    };
  }, [notice, revision, close]);
  if (!notice?.owned()) return null;
  return (
    <aside className="account-access-notice" role="status">
      <AppIcon name="pro" />
      <p>
        {planLine(notice.plan, subscriptionState(notice.plan, Date.now()), ru)}
      </p>
      <button
        type="button"
        onClick={close}
        aria-label={ru ? 'Закрыть сообщение о Pro' : 'Dismiss Pro confirmation'}
      >
        <AppIcon name="close" />
      </button>
    </aside>
  );
}
