import { useEffect, useRef, useState } from 'react';
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from 'react-router-dom';
import { BackToReader } from '@/features/reader/BackToReader';
import { withReaderReturn } from '@/features/reader/return-to-reader';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';
import type { SrsCard } from '@/db/db';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  vocabularyEntryId,
  vocabularyEntryPath,
} from '@/features/vocab/navigation';
import { useVocabularyData } from '@/features/vocab/vocabulary-data';
import { translateAddedTerm } from '@/features/vocab/manage';
import { VocabularyNav } from '@/features/vocab/VocabularyNav';
import { VocabularyCapture } from '@/features/vocab/VocabularyCapture';
import { VocabularyEntry } from '@/features/vocab/VocabularyEntry';
import { VocabularyList } from '@/features/vocab/VocabularyList';
import { useVocabularySpeech } from '@/features/vocab/useVocabularySpeech';
import '@/features/vocab/vocabulary.css';

export function VocabularyPage() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    location = useLocation(),
    navigate = useNavigate();
  const params = useParams<{ entryId: string }>(),
    fromReader = useSearchParams()[0].get('from') === 'reader';
  const entryId =
    params.entryId ??
    (location.pathname.startsWith('/vocabulary/entry/')
      ? location.pathname.slice('/vocabulary/entry/'.length)
      : null);
  const resource = useVocabularyData(),
    speech = useVocabularySpeech();
  const [adding, setAdding] = useState(false),
    [notice, setNotice] = useState(''),
    [owner, setOwner] = useState(0);
  const [lookups, setLookups] = useState<
    Record<string, 'loading' | 'unavailable'>
  >({});
  const mounted = useRef(true),
    requests = useRef(new Map<string, symbol>()),
    previousRoute = useRef(location.key);
  const entries = resource.data?.entries ?? [],
    target = entryId
      ? (entries.find((e) => vocabularyEntryId(e.key) === entryId) ?? null)
      : null;
  const link = (path: string) => (fromReader ? withReaderReturn(path) : path);
  useEffect(() => {
    mounted.current = true;
    const lookupRequests = requests.current;
    const unsubscribe = subscribeDataScope(() => {
      setAdding(false);
      setNotice('');
      setLookups({});
      setOwner((value) => value + 1);
      lookupRequests.clear();
    });
    return () => {
      mounted.current = false;
      lookupRequests.clear();
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (previousRoute.current === location.key) return;
    previousRoute.current = location.key;
    setAdding(false);
    setNotice('');
  }, [location.key]);
  const back = (message?: string) => {
    void navigate(link('/vocabulary'), {
      replace: true,
      state: { vocabularyReturn: true, vocabularyNotice: message },
    });
  };
  const openEntry = (key: string) => {
    void navigate(link(vocabularyEntryPath(key)));
  };
  const saved = (card: SrsCard, automatic: boolean) => {
    if (!automatic) return;
    const current = captureDataScope(),
      token = Symbol();
    requests.current.set(card.id, token);
    setLookups((value) => ({ ...value, [card.id]: 'loading' }));
    void translateAddedTerm(card, current)
      .catch(() => 'unavailable' as const)
      .then((result) => {
        if (
          !mounted.current ||
          !current() ||
          requests.current.get(card.id) !== token
        )
          return;
        requests.current.delete(card.id);
        setLookups((value) => {
          const next = { ...value };
          if (result === 'unavailable') next[card.id] = 'unavailable';
          else delete next[card.id];
          return next;
        });
      });
  };
  return (
    <section className="vc-page" aria-label={ru ? 'Словарь' : 'Vocabulary'}>
      <BackToReader />
      <VocabularyNav />
      {entryId && (
        <div hidden={resource.status !== 'ready'}>
          <VocabularyEntry
            key={`${owner}:${entryId}`}
            entry={target}
            deleted={!!target && !!resource.data?.deleted.has(target.key)}
            onBack={back}
            speech={speech}
            lookup={target?.cardId ? lookups[target.cardId] : undefined}
          />
        </div>
      )}
      {(!entryId || resource.status !== 'ready') && (
        <VocabularyList
          resource={resource}
          speech={speech}
          onAdd={() => {
            speech.stop();
            setAdding(true);
            setNotice('');
          }}
        />
      )}
      <p className={speech.error ? 'vc-error' : 'sr-only'} role="status">
        {speech.error}
      </p>
      <p role="status" aria-atomic="true" className="vc-detail-status">
        {notice ||
          (location.state as { vocabularyNotice?: string } | null)
            ?.vocabularyNotice}
      </p>
      <VocabularyCapture
        open={adding}
        onClose={() => setAdding(false)}
        onView={openEntry}
        onSaved={saved}
        entries={entries}
        lookups={lookups}
      />
    </section>
  );
}
