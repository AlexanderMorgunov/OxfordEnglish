import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { liveQuery } from 'dexie';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  captureDataScope,
  subscribeDataScope,
  getDataScopeRevision,
} from '@/features/account/dataScope';
import { useVocabularySpeech } from '@/features/vocab/useVocabularySpeech';
import { chapterTermPrefix, readChapterTerms } from './chapter-vocabulary';
import type { BookSource, ChapterTerm } from './chapter-vocabulary';
import { playableTerms, normalizedAnswer } from './chapter-matching';
import { ChapterMatching } from './ChapterMatching';
import { ReaderIcon } from './ReaderIcon';
import './reader-chapter.css';

export function ChapterVocabulary({
  source,
  embedded = false,
}: {
  source: BookSource;
  embedded?: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const revision = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision
  );
  const { bookKey, chapterId } = source;
  const stableSource = useMemo(
    () => ({ bookKey, chapterId }),
    [bookKey, chapterId]
  );
  const lifetime = useMemo(
    () => ({ bookKey, chapterId, current: captureDataScope() }),
    [bookKey, chapterId]
  );
  const speech = useVocabularySpeech();
  const { stop } = speech;
  useEffect(() => {
    stop();
  }, [stableSource, stop]);
  const startButton = useRef<HTMLButtonElement>(null);
  const [result, setResult] = useState<{
    source: BookSource;
    revision: number;
    terms: ChapterTerm[];
    error?: boolean;
  } | null>(null);
  const [session, setSession] = useState<{
    signature: string;
    terms: ReturnType<typeof playableTerms>;
  } | null>(null);
  const [readMode, setReadMode] = useState<'active' | 'cancelled'>('active');
  const [retry, setRetry] = useState(0);
  useEffect(
    () =>
      subscribeDataScope(() => {
        setSession(null);
        setResult(null);
      }),
    []
  );
  useEffect(() => {
    if (readMode === 'cancelled') return;
    let alive = true;
    const current = lifetime.current;
    let dispose = () => {};
    void chapterTermPrefix(stableSource)
      .then((prefix) => {
        if (!alive || !current()) return;
        const subscription = liveQuery(() =>
          readChapterTerms(stableSource, prefix)
        ).subscribe({
          next: (terms) => {
            if (alive && current())
              setResult({ source: stableSource, revision, terms });
          },
          error: () => {
            if (alive && current())
              setResult({
                source: stableSource,
                revision,
                terms: [],
                error: true,
              });
          },
        });
        dispose = () => subscription.unsubscribe();
      })
      .catch(() => {
        if (alive && current())
          setResult({ source: stableSource, revision, terms: [], error: true });
      });
    return () => {
      alive = false;
      dispose();
    };
  }, [stableSource, revision, lifetime, readMode, retry]);
  const current =
    result?.source === stableSource && result.revision === revision
      ? result
      : null;
  const terms = current?.terms ?? [];
  const eligible = playableTerms(terms);
  const signature = JSON.stringify([revision, stableSource, terms]);
  const active = session?.signature === signature;
  useEffect(() => {
    if (
      session &&
      session.signature !== signature &&
      session.signature !== 'invalidated'
    ) {
      setSession({ ...session, signature: 'invalidated' });
    }
  }, [signature, session]);
  const usable =
    eligible.length >= 2 &&
    new Set(eligible.map((t) => normalizedAnswer(t.answer))).size >= 2;
  const reload = () => {
    setResult(null);
    setReadMode('active');
    setRetry((n) => n + 1);
  };
  const content = (
    <div className="rds-chapter-vocabulary">
      {!lifetime.current() ? (
        <p role="status" className="rds-chapter-empty">
          {ru
            ? 'Аккаунт изменился. Откройте главу заново, чтобы загрузить слова.'
            : 'Account changed. Reopen the chapter to load its words.'}
        </p>
      ) : readMode === 'cancelled' ? (
        <div className="rds-chapter-state">
          <p role="status">
            {ru ? 'Загрузка отменена.' : 'Loading cancelled.'}
          </p>
          <Button variant="ghost" onClick={reload}>
            {ru ? 'Загрузить слова' : 'Load words'}
          </Button>
        </div>
      ) : !current ? (
        <div className="rds-chapter-state">
          <p role="status">{ru ? 'Загружаю слова…' : 'Loading words…'}</p>
          <Button variant="ghost" onClick={() => setReadMode('cancelled')}>
            {ru ? 'Отменить' : 'Cancel'}
          </Button>
        </div>
      ) : current.error ? (
        <div className="rds-chapter-state">
          <p role="alert" className="rds-chapter-error">
            {ru
              ? 'Не удалось загрузить слова. Попробуйте ещё раз.'
              : 'Could not load words. Please retry.'}
          </p>
          <Button variant="ghost" onClick={reload}>
            {ru ? 'Повторить' : 'Retry'}
          </Button>
        </div>
      ) : active && session ? (
        <ChapterMatching
          terms={session.terms}
          onExit={() => {
            setSession(null);
            requestAnimationFrame(() =>
              startButton.current?.focus({ preventScroll: true })
            );
          }}
        />
      ) : (
        <>
          {session && (
            <p role="status" className="rds-chapter-error">
              {ru
                ? 'Список изменился. Начните практику заново.'
                : 'The list changed. Start practice again.'}
            </p>
          )}
          {!terms.length ? (
            <p className="rds-chapter-empty">
              {ru
                ? 'Сохраняйте слова и фразы во время чтения — они появятся здесь. Ранее сохранённые слова нужно добавить из этой главы ещё раз.'
                : 'Save words and phrases while reading to see them here. Add previously saved words again from this chapter.'}
            </p>
          ) : (
            <ul className="rds-chapter-terms">
              {terms.map((term) => (
                <li key={term.id}>
                  <div>
                    <h3 lang="en">{term.front}</h3>
                    <p
                      className="rds-term-meaning"
                      lang={term.answer ? 'ru' : undefined}
                    >
                      {term.answer ??
                        (ru ? 'Перевода пока нет' : 'No translation yet')}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="rds-chapter-icon"
                    aria-pressed={speech.playing === term.front}
                    aria-label={`${speech.playing === term.front ? (ru ? 'Остановить' : 'Stop') : ru ? 'Произнести' : 'Pronounce'} ${term.front}`}
                    onClick={() => speech.speak(term.front)}
                  >
                    <ReaderIcon
                      name={speech.playing === term.front ? 'stop' : 'volume'}
                    />
                  </button>
                  {term.sentence && (
                    <details>
                      <summary>
                        {ru
                          ? 'Предложение из главы'
                          : 'Sentence from this chapter'}
                      </summary>
                      <p lang="en">{term.sentence}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
          {speech.error && (
            <p role="status" className="rds-chapter-error">
              {speech.error}
            </p>
          )}
          <div className="rds-practice-actions">
            <Button
              ref={startButton}
              disabled={!usable}
              onClick={() => {
                speech.stop();
                setSession({ signature, terms: eligible });
              }}
            >
              {ru ? 'Сопоставить пары' : 'Match pairs'}
            </Button>
          </div>
          <p className="rds-practice-note">
            {ru
              ? 'Сопоставление пар не меняет расписание повторений. Слова без перевода пропускаются.'
              : 'Matching leaves your review schedule unchanged. Words without a translation are skipped.'}
          </p>
          {!usable && (
            <p className="rds-practice-note">
              {ru
                ? 'Для практики нужны хотя бы два слова с разными переводами.'
                : 'Practice needs at least two words with different translations.'}
            </p>
          )}
        </>
      )}
    </div>
  );
  if (embedded) return content;
  return (
    <details className="rds-chapter-disclosure" data-chapter-vocabulary>
      <summary>
        {ru ? 'Слова этой главы' : 'Words from this chapter'} (
        {current && !current.error ? terms.length : '—'})
      </summary>
      {content}
    </details>
  );
}
