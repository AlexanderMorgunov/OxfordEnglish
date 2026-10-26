import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { captureDataScope, getDataScopeRevision, subscribeDataScope } from '@/features/account/dataScope';
import { useAccount } from '@/features/account/store';
import { ApiFailure } from '@/features/account/api';
import { captureAiScope, type AiPath } from '@/features/ai/route';
import { useAiStore } from '@/features/ai/store';
import { AiCacheMiss } from '@/features/ai/cache';
import { track } from '@/features/analytics/analytics';
import { passageTextParts, translatePassage, type PassageResume, type TextMode } from './text-workbench';

export type PassageResult = {
  id: number;
  source: string;
  mode: TextMode;
  state: 'loading' | 'done' | 'error' | 'cancelled';
  text: string;
  paths: AiPath[];
  completed: number;
  total: number;
  edited: boolean;
  error?: 'quota' | 'plan' | 'cache' | 'network' | 'timeout' | 'unavailable';
  resume: PassageResume;
  owned: () => boolean;
};

export function usePassageTranslation() {
  useSyncExternalStore(subscribeDataScope, getDataScopeRevision);
  // An old callback must not adopt the new owner's scope for its previous text.
  const renderOwned = captureDataScope();
  const config = useAiStore(s => s.config);
  const sessionRevision = useAccount(s => s.sessionRevision);
  const [result, setResult] = useState<PassageResult | null>(null);
  const currentResult = useRef<PassageResult | null>(null);
  const active = useRef<{ controller: AbortController; id: number; mode: TextMode; config: typeof config; sessionRevision: number } | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);

  const publish = (next: PassageResult | null) => {
    currentResult.current = next;
    if (mounted.current) setResult(next);
  };
  const cancel = () => {
    if (!renderOwned()) return;
    const pending = active.current;
    active.current = null;
    pending?.controller.abort();
    const held = currentResult.current;
    if (held?.state === 'loading') publish({ ...held, state: 'cancelled' });
  };
  const clear = () => { if (!renderOwned()) return; cancel(); publish(null); };

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = subscribeDataScope(() => {
      active.current?.controller.abort(); active.current = null;
      currentResult.current = null; setResult(null);
    });
    return () => {
      mounted.current = false;
      active.current?.controller.abort(); active.current = null;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (active.current?.mode !== 'ai' || active.current.config === config) return;
    active.current.controller.abort(); active.current = null;
    const held = currentResult.current;
    if (held?.state === 'loading') {
      const next = { ...held, state: 'cancelled' as const };
      currentResult.current = next; setResult(next);
    }
  }, [config]);
  useEffect(() => {
    if (!active.current || active.current.sessionRevision === sessionRevision) return;
    active.current.controller.abort(); active.current = null;
    const held = currentResult.current;
    if (held?.state === 'loading') {
      const next = { ...held, state: 'cancelled' as const };
      currentResult.current = next; setResult(next);
    }
  }, [sessionRevision]);

  const start = async (source: string, mode: TextMode, continuing = false, options: { cacheOnly?: boolean } = {}) => {
    if (!mounted.current || !renderOwned() || active.current) return;
    const previous = currentResult.current;
    const resuming = continuing && previous?.source === source && previous.mode === mode;
    const resume: PassageResume = resuming ? previous.resume : new Map();
    const id = ++sequence.current;
    const controller = new AbortController();
    const currentConfig = useAiStore.getState().config;
    const pending = { controller, id, mode, config: currentConfig, sessionRevision: useAccount.getState().sessionRevision };
    active.current = pending;
    const owned = captureDataScope();
    const guardAi = captureAiScope(controller.signal);
    const valid = () => {
      if (!mounted.current || !owned() || controller.signal.aborted || active.current !== pending) return false;
      if (mode === 'ai') { try { guardAi(); } catch { return false; } }
      return true;
    };
    publish({ id, source, mode, state: 'loading', text: resuming ? previous.text : '',
      paths: resuming ? previous.paths : [], completed: resuming ? previous.completed : 0, total: passageTextParts(source, mode), edited: false, resume, owned });
    try {
      const text = await translatePassage(source, { mode, config: currentConfig, signal: controller.signal, resume, cacheOnly: options.cacheOnly,
        onProgress: (partial, paths, progress) => {
          const held = currentResult.current;
          if (resuming && progress && progress.completed < previous.completed) return;
          if (valid() && held?.id === id) publish({ ...held, text: partial, paths,
            completed: progress?.completed ?? held.completed, total: progress?.total ?? held.total });
        },
      });
      const held = currentResult.current;
      if (valid() && held?.id === id) {
        publish({ ...held, state: 'done', text, completed: held.total });
        void track(mode === 'free' ? 'text_translate_free_success' : 'text_translate_ai_success');
      }
    } catch (error) {
      const held = currentResult.current;
      const reason = error instanceof AiCacheMiss ? 'cache' : error instanceof ApiFailure
        ? error.code === 'quota_exhausted' ? 'quota' : error.code === 'no_plan' ? 'plan' : error.code === 'network' ? 'network' : 'unavailable'
        : error instanceof Error && error.message === 'AI is not available' ? 'plan'
          : (error instanceof Error || error instanceof DOMException) && error.name === 'TimeoutError' ? 'timeout' : 'unavailable';
      if (valid() && held?.id === id) publish({ ...held, state: 'error', error: reason });
    } finally {
      if (active.current === pending) {
        active.current = null;
        const held = currentResult.current;
        if (mounted.current && held?.id === id && held.owned() && held.state === 'loading') {
          publish({ ...held, state: 'cancelled' });
        }
      }
    }
  };

  const editResult = (text: string) => {
    if (!renderOwned()) return;
    const held = currentResult.current;
    if (!held || held.state === 'loading') return;
    publish({ ...held, text, edited: true });
  };
  return { result, start, cancel, clear, editResult, getResult: () => currentResult.current?.owned() ? currentResult.current : null };
}
