import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { useEntitlement, quotaNotice, quotaOutlivesPlan } from './entitlement';

/**
 * The AI budget, said plainly — and only when there is something to say.
 *
 * Renders nothing on the common path, a heads-up at 80%, and on exhaustion a message that names the
 * reset date and the two ways out. Without this, running out looked like a malfunction: each caller
 * rendered its own generic failure and nothing anywhere said "budget", let alone "until when".
 */
export function QuotaNotice({ compact = false }: { compact?: boolean }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const entitlement = useEntitlement((s) => s.entitlement);
  const notice = quotaNotice(entitlement, ru);
  if (!notice) return null;

  const spent = notice.level === 'spent';
  return (
    <div
      role="status"
      className={`rounded-sm border px-3 py-2 text-sm text-pretty ${
        spent ? 'border-amber-dim bg-amber-dim/15 text-content' : 'border-line bg-surface text-muted'
      } ${compact ? 'mb-3' : 'mb-4'}`}
    >
      {notice.text}
      {spent && (
        <>
          {' '}
          <Link to="/settings" className="text-teal hover:underline">
            {ru ? 'Настройки' : 'Settings'}
          </Link>
          {/* Only when nothing refills on its own. A window that genuinely rolls needs no plan pitch —
              but a first month's "reset" IS the expiry, and hiding the link there left the one person
              who could fix it with no way to do so. */}
          {(entitlement?.ai.resetsAt == null || quotaOutlivesPlan(entitlement)) && (
            <>
              {' · '}
              <Link to="/pro" className="text-teal hover:underline">
                {ru ? 'О подписке' : 'About Pro'}
              </Link>
            </>
          )}
        </>
      )}
    </div>
  );
}
