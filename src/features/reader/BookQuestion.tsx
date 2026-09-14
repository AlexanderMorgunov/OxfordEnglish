import { useState } from 'react';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useAiStore } from '@/features/ai/store';
import { useAiEnabled, aiAvailable } from '@/features/ai/route';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { aiBookQuestion } from '@/features/ai/functions';

/**
 * "Ask about this page" — a collapsed panel under the reader. The AI answers only from the CURRENT page's
 * text (page-scoped, one call on any BYOK tier), grounded with a "not in the text" fallback and an optional
 * verbatim quote validated by `aiBookQuestion`; "show in text" scrolls the reader to the quoted sentence.
 * The page text is sent to the user's own AI provider (same as translate/simplify) — disclosed inline.
 */
export function BookQuestion({ pageText }: { pageText: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const config = useAiStore((s) => s.config);
  const enabled = useAiEnabled();
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ answer: string; quote?: string } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'error'>('idle');

  const ask = async () => {
    if (!q.trim() || !aiAvailable(config)) return;
    setState('loading');
    setAnswer(null);
    try {
      setAnswer(await aiBookQuestion(config, { pageText, question: q }));
      setState('idle');
    } catch {
      setState('error');
    }
  };

  const showInText = (quote: string) => {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ');
    const el = Array.from(document.querySelectorAll<HTMLElement>('p[data-para]')).find((p) =>
      norm(p.textContent ?? '').includes(norm(quote))
    );
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.style.transition = 'background-color .35s';
    el.style.backgroundColor = 'var(--color-surface-2)';
    setTimeout(() => (el.style.backgroundColor = ''), 1500);
  };

  return (
    <details className="mt-8">
      <summary className="inline-flex cursor-pointer list-none items-center gap-1 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline [&::-webkit-details-marker]:hidden">
        ❓ {ru ? 'Спросить по этой странице' : 'Ask about this page'}
      </summary>
      <div className="mt-3 flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4">
        {enabled ? (
          <>
            <div className="flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void ask();
                }}
                placeholder={ru ? 'Вопрос по этому тексту…' : 'A question about this text…'}
                aria-label={ru ? 'Вопрос по странице' : 'Question about the page'}
                className="min-w-0 flex-1 rounded-sm border border-line bg-ink px-3 py-2 text-base text-content placeholder:text-faint focus:border-teal"
              />
              <Button size="sm" onClick={() => void ask()} disabled={state === 'loading' || !q.trim()}>
                {state === 'loading' ? '…' : ru ? 'Спросить' : 'Ask'}
              </Button>
            </div>
            <p className="font-mono text-2xs text-muted">
              {ru
                ? 'Ответ — только по тексту этой страницы; текст уходит вашему AI-провайдеру.'
                : 'Answered from this page only; the text is sent to your AI provider.'}
            </p>
            {state === 'error' && (
              <p className="font-mono text-2xs text-coral">
                {ru ? 'Не удалось получить ответ. Попробуйте ещё раз.' : 'Could not get an answer. Try again.'}
              </p>
            )}
            {answer?.answer && (
              <div className="rounded-sm border-l-[3px] border-violet bg-violet-dim/15 px-3.5 py-2.5 text-sm leading-relaxed">
                <span className="mr-2 font-mono text-2xs uppercase tracking-[0.08em] text-violet">ai</span>
                {answer.answer}
                {answer.quote && (
                  <button
                    type="button"
                    onClick={() => showInText(answer.quote!)}
                    className="ml-2 whitespace-nowrap font-mono text-2xs text-teal hover:underline"
                  >
                    {ru ? 'показать в тексте →' : 'show in text →'}
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <AiUpsellLink />
        )}
      </div>
    </details>
  );
}
