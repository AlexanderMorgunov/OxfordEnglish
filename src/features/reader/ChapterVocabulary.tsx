import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { liveQuery } from 'dexie';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { captureDataScope, subscribeDataScope, getDataScopeRevision } from '@/features/account/dataScope';
import { chapterTermPrefix, readChapterTerms, type BookSource, type ChapterTerm } from './chapter-vocabulary';
import { playableTerms, normalizedAnswer } from './chapter-matching';
import { ChapterMatching } from './ChapterMatching';

export function ChapterVocabulary({ source }: { source: BookSource }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const revision = useSyncExternalStore(subscribeDataScope, getDataScopeRevision);
  const { bookKey, chapterId } = source;
  const lifetime = useMemo(() => ({ bookKey, chapterId, current: captureDataScope() }), [bookKey, chapterId]);
  const startButton = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<{ source: BookSource; revision: number; terms: ChapterTerm[]; error?: boolean } | null>(null);
  const [session, setSession] = useState<{ signature: string; terms: ReturnType<typeof playableTerms> } | null>(null);
  useEffect(() => subscribeDataScope(() => {
    setSession(null);
    setResult(null);
  }), []);
  useEffect(() => {
    let alive = true;
    const current = lifetime.current;
    let dispose = () => {};
    void chapterTermPrefix(source).then((prefix) => {
      if (!alive || !current()) return;
      const subscription = liveQuery(() => readChapterTerms(source, prefix)).subscribe({
        next: (terms) => { if (alive && current()) setResult({ source, revision, terms }); },
        error: () => { if (alive && current()) setResult({ source, revision, terms: [], error: true }); },
      });
      dispose = () => subscription.unsubscribe();
    }).catch(() => { if (alive && current()) setResult({ source, revision, terms: [], error: true }); });
    return () => { alive = false; dispose(); };
  }, [source, revision, lifetime]);
  const current = result?.source === source && result.revision === revision ? result : null;
  const terms = current?.terms ?? [];
  const eligible = playableTerms(terms);
  const signature = JSON.stringify([revision, source, terms]);
  const active = session?.signature === signature;
  useEffect(() => {
    if (session && session.signature !== signature && session.signature !== 'invalidated') {
      setSession({ ...session, signature: 'invalidated' });
    }
  }, [signature, session]);
  const usable = eligible.length >= 2 && new Set(eligible.map((t) => normalizedAnswer(t.answer))).size >= 2;
  return <details className="group/chapter mt-4 rounded-sm border border-line bg-surface px-3 py-1" data-chapter-vocabulary>
    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-semibold tabular-nums text-content">
      <span aria-hidden="true" className="mr-2 transition-transform group-open/chapter:rotate-90">▸</span>
      {ru ? 'Слова этой главы' : 'Words from this chapter'} ({terms.length})
    </summary>
    <div className="space-y-2 pb-2">
      {!lifetime.current() ? <p role="status" className="text-sm text-muted">{ru ? 'Аккаунт изменился. Откройте главу заново, чтобы загрузить слова.' : 'Account changed. Reopen the chapter to load its words.'}</p>
        : !current ? <p role="status" className="text-sm text-muted">{ru ? 'Загружаю…' : 'Loading…'}</p>
        : current.error ? <p role="alert" className="text-sm text-muted">{ru ? 'Не удалось загрузить слова. Откройте книгу заново.' : 'Could not load words. Reopen the book.'}</p>
        : !terms.length ? <p className="text-sm text-muted">{ru ? 'Сохраняйте слова и фразы во время чтения — они появятся здесь. Ранее сохранённые слова нужно добавить из этой главы ещё раз.' : 'Save words and phrases while reading to see them here. Add previously saved words again from this chapter.'}</p>
        : active && session ? <ChapterMatching terms={session.terms} onExit={() => {
          setSession(null);
          requestAnimationFrame(() => startButton.current?.focus({ preventScroll: true }));
        }} />
        : <>
          {session && <p role="status" className="text-sm text-muted">{ru ? 'Список изменился. Начните практику заново.' : 'The list changed. Start practice again.'}</p>}
          <ul className="divide-y divide-line">
            {terms.map((term) => <li key={term.id} className="space-y-0.5 py-2 text-sm break-words">
              <p lang="en" className="font-semibold text-content">{term.front}</p>
              <p lang={term.answer ? 'ru' : undefined} className="text-muted">{term.answer ?? (ru ? 'Перевода пока нет' : 'No translation yet')}</p>
              {term.sentence && <details><summary className="flex min-h-11 cursor-pointer items-center text-xs text-muted">{ru ? 'Предложение из главы' : 'Sentence from this chapter'}</summary><p lang="en" className="pb-1 text-sm text-muted">{term.sentence}</p></details>}
            </li>)}
          </ul>
          <p className="text-xs text-muted">{ru ? 'Сопоставление пар не меняет расписание повторений. Слова без перевода пропускаются.' : 'Matching leaves your review schedule unchanged. Words without a translation are skipped.'}</p>
          <Button ref={startButton} className="min-h-11" disabled={!usable} onClick={() => setSession({ signature, terms: eligible })}>{ru ? 'Сопоставить пары' : 'Match pairs'}</Button>
          {!usable && <p className="text-xs text-muted">{ru ? 'Для практики нужны хотя бы два слова с разными переводами.' : 'Practice needs at least two words with different translations.'}</p>}
        </>}
    </div>
  </details>;
}
