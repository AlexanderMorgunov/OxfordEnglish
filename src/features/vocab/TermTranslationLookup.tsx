import { useEffect, useId, useRef, useState } from 'react';
import { captureDataScope, subscribeDataScope } from '@/features/account/dataScope';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button, Input } from '@/shared/ui';
import { translateTermProposal } from './translate';

export function TermTranslationLookup({ term, draftRevision, disabled = false, onApply }: {
  term: string; draftRevision: number; disabled?: boolean; onApply: (translation: string) => void;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const id = useId();
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [proposal, setProposal] = useState('');
  const [issue, setIssue] = useState<'term' | 'lookup' | null>(null);
  const active = useRef<AbortController | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(false);
  const latest = useRef({ term, draftRevision, disabled });
  latest.current = { term, draftRevision, disabled };
  const button = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const proposalOwner = useRef<{ term: string; revision: number; current: () => boolean } | null>(null);
  const clear = () => {
    proposalOwner.current = null;
    if (timer.current) clearTimeout(timer.current); timer.current = null;
    active.current?.abort(); active.current = null;
    setState('idle'); setProposal(''); setIssue(null);
  };
  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeDataScope(clear);
    return () => { mounted.current = false; active.current?.abort(); active.current = null; if (timer.current) clearTimeout(timer.current); unsubscribe(); };
  }, []);
  useEffect(() => { clear(); }, [term, draftRevision, disabled]);
  useEffect(() => { if (state === 'loading') cancelButton.current?.focus(); }, [state]);

  const lookup = async () => {
    if (disabled || active.current) return;
    if (!term.trim() || term.trim().length > 80 || !/[a-z]/i.test(term) || /[а-яё\r\n]/i.test(term)) {
      setIssue('term'); setState('error'); return;
    }
    const controller = new AbortController();
    const current = captureDataScope();
    const valid = () => mounted.current && current() && active.current === controller &&
      !controller.signal.aborted && latest.current.term === term &&
      latest.current.draftRevision === draftRevision && !latest.current.disabled;
    active.current = controller;
    setState('loading'); setIssue(null); setProposal('');
    const timeout = setTimeout(() => {
      if (!valid()) return;
      controller.abort(); active.current = null; timer.current = null;
      setIssue('lookup'); setState('error'); button.current?.focus();
    }, 8000);
    timer.current = timeout;
    try {
      const result = await translateTermProposal(term, { signal: controller.signal, fresh: state === 'error' });
      if (!valid()) return;
      const focusResult = document.activeElement === cancelButton.current || document.activeElement === button.current;
      if (result) { proposalOwner.current = { term, revision: draftRevision, current }; setProposal(result); setState('done'); }
      else { setIssue('lookup'); setState('error'); }
      if (focusResult) requestAnimationFrame(() => {
        if (mounted.current && current() && latest.current.term === term && latest.current.draftRevision === draftRevision)
          (result ? input : button).current?.focus();
      });
    } catch {
      if (valid()) { setIssue('lookup'); setState('error'); }
    } finally {
      clearTimeout(timeout);
      if (timer.current === timeout) timer.current = null;
      if (active.current === controller) active.current = null;
    }
  };

  const apply = () => {
    const owner = proposalOwner.current;
    if (latest.current.disabled || !owner?.current() || owner.term !== latest.current.term ||
      owner.revision !== latest.current.draftRevision || !proposal.trim()) return;
    onApply(proposal.trim());
  };

  return <div className="min-w-0 space-y-2">
    <div className="flex flex-wrap gap-2">
      <Button ref={button} variant="ghost" size="sm" className="min-h-11" disabled={disabled || state === 'loading' || !term.trim()} onClick={() => void lookup()}>
        {ru ? 'Перевести · бесплатно' : 'Translate · free'}
      </Button>
      {state === 'loading' && <Button ref={cancelButton} variant="ghost" size="sm" className="min-h-11" onClick={() => { clear(); button.current?.focus(); }}>{ru ? 'Отменить поиск' : 'Cancel lookup'}</Button>}
    </div>
    {state === 'loading' && <p role="status" className="text-sm text-muted">{ru ? 'Ищем перевод…' : 'Looking up translation…'}</p>}
    {state === 'error' && <p role="alert" className="text-sm text-coral">{issue === 'term'
      ? ru ? 'Введите английское слово или фразу до 80 символов.' : 'Enter an English word or phrase of up to 80 characters.'
      : ru ? 'Перевод недоступен. Проверьте сеть и повторите поиск или введите перевод вручную.' : 'Translation unavailable. Check connectivity and retry or enter a translation manually.'}</p>}
    {state === 'done' && <div className="space-y-2 border-l-2 border-teal-dim pl-3">
      <label htmlFor={id} className="block text-sm text-muted">{ru ? 'Предложенный перевод' : 'Suggested translation'}</label>
      <Input ref={input} id={id} lang="ru" value={proposal} disabled={disabled} onChange={event => setProposal(event.target.value)}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); apply(); } }} />
      <p className="text-xs text-muted">{ru ? 'Проверьте значение. Текущий перевод изменится только после применения.' : 'Check the meaning. Your current translation changes only when you apply this suggestion.'}</p>
      <Button variant="ghost" size="sm" className="min-h-11" disabled={disabled || !proposal.trim()} onClick={apply}>{ru ? 'Применить перевод' : 'Use translation'}</Button>
    </div>}
  </div>;
}
