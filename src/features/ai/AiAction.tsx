import { useEffect, useRef, useState } from 'react';
import { Button } from '@/shared/ui';
import { AiUpsellLink } from './AiUpsellLink';
import { useAiStore } from './store';
import { captureAiScope, useAiEnabled, useAiUnknown } from './route';
import { useUiLang } from '@/features/i18n/uiLang';
import { ApiFailure } from '@/features/account/api';
import { useAccount } from '@/features/account/store';
import type { AiConfig } from './provider';

type Props = {
  label: string;
  run: (config: AiConfig | null, signal: AbortSignal) => Promise<string>;
  onDelivered?: () => void;
  canRun?: boolean;
};


/** One readable sentence per failure the AI path can actually produce. */
function aiErrorText(e: unknown, ru: boolean): string {
  const code = e instanceof ApiFailure ? e.code : '';
  if (code === 'quota_exhausted') return ru ? 'Запросы ИИ на этот период израсходованы.' : 'The AI budget for this period is spent.';
  if (code === 'no_plan') return ru ? 'Для этого нужна подписка или свой ключ ИИ.' : 'This needs a subscription or your own AI key.';
  if (code === 'network') return ru ? 'Нет связи с сервером — попробуйте позже.' : 'No connection to the server — try again later.';
  if (code === 'rate_limited') return ru ? 'Слишком часто. Подождите немного.' : 'Too many requests. Wait a moment.';
  return ru ? 'ИИ не ответил. Попробуйте ещё раз.' : 'The AI did not answer. Try again.';
}

export function AiAction({ label, run, onDelivered, canRun = true }: Props) {
  const config = useAiStore((s) => s.config);
  const sessionRevision = useAccount((s) => s.sessionRevision);
  const enabled = useAiEnabled();
  const unknown = useAiUnknown();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    setLoading(false);
    setText(null);
    setError(null);
    return () => { pending.current?.abort(); pending.current = null; };
  }, [config, sessionRevision]);

  // Unknown entitlement is not a denial; allow an explicit request to check access.
  if (!enabled && !unknown) {
    return <AiUpsellLink />;
  }

  const go = async () => {
    if (pending.current || !canRun) return;
    const controller = new AbortController();
    pending.current = controller;
    const requireActive = captureAiScope(controller.signal);
    setLoading(true);
    setError(null);
    try {
      const result = await run(config, controller.signal);
      requireActive();
      if (!result.trim()) throw new Error('Empty AI answer');
      setText(result);
      onDelivered?.();
    } catch (e) {
      if (controller.signal.aborted || (e instanceof Error && e.name === 'AbortError')) return;
      setError(aiErrorText(e, ru));
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div>
      {text === null && (
        <Button
          size="sm"
          variant="ghost"
          className="border-violet-dim text-violet"
          onClick={() => void go()}
          disabled={loading || !canRun}
        >
          {loading ? '…' : label}
        </Button>
      )}
      {loading && <Button size="sm" variant="ghost" onClick={() => {
        pending.current?.abort();
        pending.current = null;
        setLoading(false);
      }}>{ru ? 'Отменить' : 'Cancel'}</Button>}
      {text !== null && (
        <div role="status" className="mt-2 rounded-sm border-l-[3px] border-violet bg-violet-dim/20 px-3.5 py-2.5 text-sm leading-relaxed">
          <span className="mr-2 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
            ai
          </span>
          {text}
        </div>
      )}
      {error && <p role="alert" className="mt-1 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}
