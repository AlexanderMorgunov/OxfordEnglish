import { useState } from 'react';
import { Button } from '@/shared/ui';
import { AiUpsellLink } from './AiUpsellLink';
import { useAiStore } from './store';
import { useAiEnabled, useAiUnknown } from './route';
import { useUiLang } from '@/features/i18n/uiLang';
import { ApiFailure } from '@/features/account/api';
import type { AiConfig } from './provider';

type Props = {
  label: string;
  run: (config: AiConfig | null) => Promise<string>;
  onRun?: () => void;
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

export function AiAction({ label, run, onRun }: Props) {
  const config = useAiStore((s) => s.config);
  const enabled = useAiEnabled();
  const unknown = useAiUnknown();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  //  means we could not read the plan, not that there is none — let the request go and the
  // server answer. Refusing here is how a subscriber got shown an upsell for what they already own.
  if (!enabled && !unknown) {
    return <AiUpsellLink />;
  }

  const go = async () => {
    setLoading(true);
    setError(null);
    onRun?.();
    try {
      setText(await run(config));
    } catch (e) {
      // Raw messages leaked internal codes and an English literal into a Russian UI.
      setError(aiErrorText(e, ru));
    } finally {
      setLoading(false);
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
          disabled={loading}
        >
          {loading ? '…' : label}
        </Button>
      )}
      {text !== null && (
        <div className="mt-2 rounded-sm border-l-[3px] border-violet bg-violet-dim/20 px-3.5 py-2.5 text-sm leading-relaxed">
          <span className="mr-2 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
            ai
          </span>
          {text}
        </div>
      )}
      {error && <p className="mt-1 font-mono text-2xs text-coral">{error}</p>}
    </div>
  );
}
