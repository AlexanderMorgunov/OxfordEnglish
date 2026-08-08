import { useState } from 'react';
import { Button } from '@/shared/ui';
import { isConfigured, useAiStore } from './store';
import type { AiConfig } from './provider';

type Props = { label: string; run: (config: AiConfig) => Promise<string> };

export function AiAction({ label, run }: Props) {
  const config = useAiStore((s) => s.config);
  const [loading, setLoading] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isConfigured(config)) {
    return (
      <span className="font-mono text-2xs text-faint">
        AI off — add a key in settings
      </span>
    );
  }

  const go = async () => {
    setLoading(true);
    setError(null);
    try {
      setText(await run(config));
    } catch (e) {
      setError((e as Error).message);
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
