import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import {
  dropCard,
  repairCardBack,
  reviewableCards,
} from '@/features/srs/service';
import { Button, Eyebrow, Input, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { speakWord } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { translateText, translateWord } from '@/features/vocab/translate';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { addTerm, setTranslation, translateAddedTerm } from '@/features/vocab/manage';
import {
  buildLexicon,
  matchesFilter,
  sortLexicon,
  searchLexicon,
  type LexiconEntry,
  type LexiconFilter,
  type LexiconSort,
} from '@/features/vocab/lexicon';
import { baseForm, useLemma } from '@/features/vocab/lemma';
import { irregularForms } from '@/features/vocab/irregular';
import { FormsLine } from '@/features/vocab/FormsLine';
import { cefrOf, useCefr } from '@/features/vocab/cefr';
import { CefrChip } from '@/features/vocab/CefrChip';
import { ContextSentence } from '@/features/vocab/ContextSentence';
import { BackToReader } from '@/features/reader/BackToReader';
import { isDeleted } from '@/features/sync/resolve';
import {
  captureDataScope,
  subscribeDataScope,
} from '@/features/account/dataScope';

const FILTERS: { id: LexiconFilter; ru: string; en: string }[] = [
  { id: 'all', ru: 'все', en: 'all' },
  { id: 'learning', ru: 'учу', en: 'learning' },
  { id: 'known', ru: 'знаю', en: 'known' },
  { id: 'saved', ru: 'сохранённые', en: 'saved' },
  { id: 'phrases', ru: 'фразы', en: 'phrases' },
  { id: 'ignored', ru: 'игнор', en: 'ignored' },
];

const SORTS: { id: LexiconSort; ru: string; en: string }[] = [
  { id: 'recent', ru: 'недавние', en: 'recent' },
  { id: 'alpha', ru: 'по алфавиту', en: 'A–Z' },
  { id: 'due', ru: 'по сроку', en: 'due' },
  { id: 'useful', ru: 'по полезности', en: 'most useful' },
];

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-4 py-3">
      <p className="font-mono text-xl tabular-nums text-content">{n}</p>
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">{label}</p>
    </div>
  );
}

export function VocabularyPage() {
  // Hoisted: the pronounce button reads it from inside the entry `.map`, where a hook cannot go.
  const canSpeak = useSpeechAvailable();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const updateStatus = useVocabStore((s) => s.updateStatus);
  // Arrived from the reader's widget → offer a back-to-reader that pops history (restores scroll +
  // chapter). Only shown then, since /vocabulary is also reachable from the header nav.

  const [entries, setEntries] = useState<LexiconEntry[] | null>(null);
  const [stats, setStats] = useState({ marked: 0, cards: 0, due: 0 });
  const [filter, setFilter] = useState<LexiconFilter>('all');
  const [sort, setSort] = useState<LexiconSort>('recent');
  const [q, setQ] = useState('');
  // Cap the rendered rows so a multi-thousand-term lexicon doesn't mount tens of thousands of
  // nodes or re-render the whole list on every search keystroke.
  const [limit, setLimit] = useState(100);
  useEffect(() => setLimit(100), [q, filter, sort]);

  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState('');
  const [newTr, setNewTr] = useState('');
  const [newCtx, setNewCtx] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const [savedTerm, setSavedTerm] = useState('');
  const [lookups, setLookups] = useState<Record<string, 'loading' | 'unavailable'>>({});
  const saveLock = useRef(false);
  const lookupRequests = useRef(new Map<string, symbol>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);
  const [editKey, setEditKey] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [editError, setEditError] = useState('');
  // Lazy word data (base forms, CEFR levels); empty until loaded, so rows render immediately.
  const lemma = useLemma();
  const cefr = useCefr();

  const reload = useCallback(async () => {
    const current = captureDataScope();
    try {
      const [statuses, cards, translations] = await Promise.all([
        db.wordStatus.toArray(),
        db.srsCards.toArray(),
        db.translations.toArray(),
      ]);
      const now = Date.now();
      if (!current()) return;
      const live = cards.filter((c) => !c.fromError && !isDeleted(c));
      const reviewable = reviewableCards(
        cards,
        new Set(
          statuses
            .filter((s) => s.status === 'ignored')
            .map((s) => s.word.toLowerCase())
        )
      );
      setStats({
        marked: statuses.filter((s) => s.status === 'known' || s.status === 'learning').length,
        cards: live.length,
        due: reviewable.filter(
          (c) => (c.due instanceof Date ? c.due : new Date(c.due)).getTime() <= now
        ).length,
      });
      setEntries(buildLexicon({ statuses, cards, translations }));
    } catch {
      if (current()) setEntries([]);
    }
  }, []);

  useEffect(() => {
    const subscription = liveQuery(reload).subscribe();
    const unsubscribe = subscribeDataScope(() => {
      setEntries(null);
      setStats({ marked: 0, cards: 0, due: 0 });
      setEditKey(null);
      setAdding(false);
      setNewTerm('');
      setNewTr('');
      setNewCtx('');
      setAddError('');
      setSavedTerm('');
      setSaving(false);
      saveLock.current = false;
      lookupRequests.current.clear();
      setLookups({});
      void reload();
    });
    return () => {
      subscription.unsubscribe();
      unsubscribe();
    };
  }, [reload]);

  const view = useMemo(() => {
    if (!entries) return [];
    const v = entries.filter((e) => matchesFilter(e, filter));
    return searchLexicon(
      sortLexicon(v, sort, (e) => cefrOf(e.display, cefr, lemma)?.order ?? Number.MAX_SAFE_INTEGER),
      q
    );
  }, [entries, filter, q, sort, cefr, lemma]);

  const changeStatus = async (e: LexiconEntry, status: 'learning' | 'known' | 'ignored') => {
    await updateStatus(e.display, status);
    await reload();
  };
  const removeCard = async (e: LexiconEntry) => {
    if (!e.cardId) return;
    // Soft: a hard delete left the row on the server, so the next pull put the card back and the user
    // removed the same word again and again.
    await dropCard(e.cardId);
    await reload();
  };
  const translateOne = async (e: LexiconEntry) => {
    const current = captureDataScope();
    const ruText = await (e.kind === 'phrase' ? translateText : translateWord)(
      e.display
    );
    if (!current()) return;
    if (ruText && e.cardId) await repairCardBack(e.cardId, ruText, current);
    await reload();
  };
  const startEdit = (e: LexiconEntry) => {
    setEditError('');
    setEditKey(e.key);
    setDraft(e.translation ?? '');
  };
  const saveEdit = async (e: LexiconEntry) => {
    try {
      if (!(await setTranslation(e, draft))) throw new Error('Card changed');
      setEditKey(null);
      await reload();
    } catch {
      setEditError(
        ru
          ? 'Не удалось сохранить перевод. Обновите карточку и попробуйте ещё раз.'
          : 'Could not save the translation. Refresh the entry and try again.'
      );
    }
  };
  const addNew = async () => {
    if (!newTerm.trim() || saveLock.current) return;
    const current = captureDataScope();
    const active = () => alive.current && current();
    const automatic = !newTr.trim();
    saveLock.current = true;
    setSaving(true);
    setAddError('');
    try {
      const saved = await addTerm(newTerm, newTr, newCtx);
      if (!active()) return;
      if (!saved) {
        setAddError(ru ? 'Не удалось сохранить. Попробуйте ещё раз.' : 'Could not save. Please try again.');
        return;
      }
      setNewTerm('');
      setNewTr('');
      setNewCtx('');
      setAdding(false);
      setSavedTerm(saved.front);
      if (automatic) {
        const request = Symbol();
        lookupRequests.current.set(saved.id, request);
        setLookups((value) => ({ ...value, [saved.id]: 'loading' }));
        void translateAddedTerm(saved, current).catch(() => 'unavailable' as const).then((result) => {
          if (!active() || lookupRequests.current.get(saved.id) !== request) return;
          lookupRequests.current.delete(saved.id);
          setLookups((value) => {
            const next = { ...value };
            if (result === 'unavailable') next[saved.id] = 'unavailable';
            else delete next[saved.id];
            return next;
          });
        });
      }
      await reload();
    } finally {
      if (current()) saveLock.current = false;
      if (active()) setSaving(false);
    }
  };

  return (
    <section aria-label={ru ? 'Словарь' : 'Vocabulary'}>
      <BackToReader />
      <Eyebrow className="mb-3.5">lexicon</Eyebrow>
      {editError && (
        <p role="alert" className="mb-3 text-sm text-coral">
          {editError}
        </p>
      )}
      <div className="mb-6 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/vocab.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">{ru ? 'Мой словарь' : 'My vocabulary'}</h1>
      </div>

      <div className="mb-6 flex flex-wrap items-stretch gap-2.5">
        <Stat n={stats.marked} label={ru ? 'отмечено слов' : 'marked words'} />
        <Stat n={stats.cards} label={ru ? 'карточек' : 'cards'} />
        <Link to="/review" className="rounded-md border border-teal-dim bg-teal-dim/10 px-4 py-3 transition-colors hover:border-teal">
          <p className="font-mono text-xl tabular-nums text-teal">{stats.due}</p>
          <p className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
            {ru ? 'к повторению →' : 'due → review'}
          </p>
        </Link>
      </div>

      <div className="mb-6">
        {adding ? (
          <form className="flex flex-col gap-2.5 rounded-lg border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void addNew(); }}>
            <label htmlFor="new-term" className="text-sm text-muted">{ru ? 'Слово или фраза на английском' : 'English word or phrase'}</label>
            <Input
              id="new-term"
              disabled={saving}
              placeholder={ru ? 'слово или фраза (англ.)' : 'word or phrase (English)'}
              value={newTerm}
              onChange={(e) => setNewTerm(e.target.value)}
              autoFocus
            />
            <label htmlFor="new-translation" className="text-sm text-muted">{ru ? 'Перевод' : 'Translation'}</label>
            <Input
              id="new-translation"
              disabled={saving}
              placeholder={ru ? 'перевод (необязательно)' : 'translation (optional)'}
              value={newTr}
              onChange={(e) => setNewTr(e.target.value)}
            />
            <p className="text-sm text-muted">{ru ? 'Оставьте пустым — найдём перевод после добавления. Его можно исправить.' : 'Leave blank for automatic translation after adding. You can edit it.'}</p>
            <label htmlFor="new-context" className="text-sm text-muted">{ru ? 'Пример или контекст' : 'Example or context'}</label>
            <Input
              id="new-context"
              disabled={saving}
              placeholder={ru ? 'пример/контекст (необязательно)' : 'example/context (optional)'}
              value={newCtx}
              onChange={(e) => setNewCtx(e.target.value)}
            />
            {addError && <p role="alert" className="text-sm text-coral">{addError}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" disabled={!newTerm.trim() || saving}>
                {saving ? ru ? 'Сохраняем…' : 'Saving…' : ru ? 'Добавить' : 'Add'}
              </Button>
              <button
                type="button"
                disabled={saving}
                onClick={() => { setAdding(false); setAddError(''); }}
                className="font-mono text-2xs uppercase tracking-[0.08em] text-muted hover:text-content"
              >
                {ru ? 'отмена' : 'cancel'}
              </button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            onClick={() => { setAdding(true); setSavedTerm(''); }}
            className="rounded-sm border border-line px-3 py-2 font-mono text-2xs uppercase tracking-[0.08em] text-teal transition-colors hover:border-teal-dim"
          >
            {ru ? '＋ добавить слово или фразу' : '＋ add a word or phrase'}
          </button>
        )}
        <p role="status" aria-atomic="true" className={savedTerm ? 'mt-3 text-sm text-teal' : 'sr-only'}>
          {savedTerm && (ru ? `Сохранено в словаре: «${savedTerm}».` : `Saved in vocabulary: “${savedTerm}”.`)}
        </p>
      </div>

      {entries !== null && entries.length === 0 && !adding ? (
        <div className="rounded-lg border border-line bg-surface p-5 text-center">
          <PixelImage src="/assets/pixel/mascot.png" alt="" className="mx-auto mb-4 h-24 w-24 opacity-90" />
          <p className="text-sm text-pretty text-muted">
            {ru
              ? 'Пока пусто. Тапайте слова во время чтения или в уроках — они собираются здесь, вместе с переводом и расписанием повторений.'
              : 'Empty for now. Tap words while reading or in lessons — they collect here with their translation and review schedule.'}
          </p>
          <Link to="/library" className="mt-3 inline-block font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline">
            {ru ? '→ в библиотеку' : '→ to the library'}
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={ru ? 'поиск по слову или переводу…' : 'search word or translation…'}
              className="w-full rounded-sm border border-line bg-ink px-3 py-2.5 text-base text-content transition-colors duration-150 placeholder:text-faint focus:border-teal"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={ru ? 'Фильтр' : 'Filter'}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={filter === f.id}
                  onClick={() => setFilter(f.id)}
                  className={[
                    'rounded-sm px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.06em] transition-colors',
                    filter === f.id ? 'bg-surface-2 text-teal' : 'text-muted hover:text-content',
                  ].join(' ')}
                >
                  {ru ? f.ru : f.en}
                </button>
              ))}
              <span className="ml-auto flex items-center gap-1.5">
                {SORTS.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    aria-pressed={sort === s.id}
                    onClick={() => setSort(s.id)}
                    className={[
                      'rounded-sm px-2 py-1 font-mono text-2xs transition-colors',
                      sort === s.id ? 'text-teal underline' : 'text-muted hover:text-content',
                    ].join(' ')}
                  >
                    {ru ? s.ru : s.en}
                  </button>
                ))}
              </span>
            </div>
          </div>

          <p className="mb-3 font-mono text-2xs text-muted" aria-live="polite">
            {view.length} {ru ? 'слов и фраз' : 'words & phrases'}
          </p>

          <ul className="flex flex-col gap-2" role="group" aria-label={ru ? 'Словарь' : 'Vocabulary list'}>
            {view.slice(0, limit).map((e) => {
              const forms = e.kind === 'word' ? irregularForms(e.display, lemma) : [];
              const base = e.kind === 'word' && !forms.length ? baseForm(e.display, lemma) : null;
              const rated = cefrOf(e.display, cefr, lemma);
              const showLevel = rated !== null;
              return (
                <li key={e.key} className="rounded-md border border-line bg-surface px-4 py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex items-baseline gap-2">
                      <span className="text-base text-content">{e.display}</span>
                      {canSpeak && (
                        <button
                          type="button"
                          aria-label={`${ru ? 'Произнести' : 'Pronounce'} ${e.display}`}
                          className="text-teal transition-opacity hover:opacity-80"
                          onClick={() => speakWord(e.display)}
                        >
                          🔊
                        </button>
                      )}
                      {e.status && (
                      <span className="font-mono text-2xs uppercase tracking-[0.06em] text-muted">
                        {e.status === 'learning'
                          ? ru
                            ? 'учу'
                            : 'learning'
                          : e.status === 'known'
                            ? ru
                              ? 'знаю'
                              : 'known'
                            : ru
                              ? 'игнор'
                              : 'ignored'}
                      </span>
                    )}
                      {e.kind === 'phrase' && (
                      <span className="font-mono text-2xs uppercase tracking-[0.06em] text-violet">
                        {ru ? 'фраза' : 'phrase'}
                      </span>
                    )}
                      {showLevel && <CefrChip level={rated?.level ?? null} />}
                      {base && (
                        <span className="font-mono text-2xs text-muted">
                          {ru ? 'база' : 'base'}:{' '}
                          <span className="text-content">{base}</span>
                        </span>
                      )}
                    </span>
                    {editKey === e.key ? (
                    <span className="flex items-center gap-1.5">
                      <input
                        value={draft}
                        onChange={(ev) => setDraft(ev.target.value)}
                        onKeyDown={(ev) => {
                          if (ev.key === 'Enter') void saveEdit(e);
                          if (ev.key === 'Escape') setEditKey(null);
                        }}
                        autoFocus
                        aria-label={ru ? 'Перевод' : 'Translation'}
                        className="w-40 rounded-sm border border-teal-dim bg-ink px-2 py-1 text-sm text-content focus:border-teal"
                      />
                      <button
                        type="button"
                        onClick={() => void saveEdit(e)}
                        className="font-mono text-2xs text-teal hover:underline"
                      >
                        {ru ? 'ок' : 'ok'}
                      </button>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm text-muted">
                      {e.translation ? (
                        <>
                          {e.translation}
                          <button
                            type="button"
                            aria-label={ru ? 'Изменить перевод' : 'Edit translation'}
                            onClick={() => startEdit(e)}
                            className="text-2xs text-muted transition-colors hover:text-teal"
                          >
                            ✎
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => void translateOne(e)}
                            className="font-mono text-2xs text-teal hover:underline"
                          >
                            {ru ? '— перевести' : '— translate'}
                          </button>
                          <button
                            type="button"
                            aria-label={ru ? 'Ввести перевод' : 'Enter translation'}
                            onClick={() => startEdit(e)}
                            className="text-2xs text-muted transition-colors hover:text-teal"
                          >
                            ✎
                          </button>
                        </>
                      )}
                    </span>
                  )}
                  </div>

                  <FormsLine word={e.display} forms={forms} className="mt-1 font-mono text-2xs" />
                  {e.cardId && !e.translation && lookups[e.cardId] && (
                    <p role="status" className="mt-1 text-sm text-muted">
                      {lookups[e.cardId] === 'loading'
                        ? ru ? 'Ищем перевод…' : 'Looking up translation…'
                        : ru ? 'Перевод недоступен. Можно ввести вручную или повторить поиск.' : 'Translation unavailable. Enter it manually or retry the lookup.'}
                    </p>
                  )}

                  {e.contextGloss && (
                  <p className="mt-1.5 text-sm text-content">
                    <span className="mr-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
                      {ru ? 'в контексте' : 'in context'}
                    </span>
                    {e.contextGloss}
                  </p>
                )}

                  {e.context && (
                  <ContextSentence
                    text={e.context}
                    term={e.display}
                    isPhrase={e.kind === 'phrase'}
                    data={lemma}
                    className="mt-1.5 border-l-2 border-line pl-2 text-sm text-muted text-pretty"
                  />
                )}

                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {(['learning', 'known', 'ignored'] as const).map((st) => (
                      <button
                      key={st}
                      type="button"
                      disabled={e.status === st}
                      onClick={() => void changeStatus(e, st)}
                      className="rounded-sm border border-line px-2 py-0.5 font-mono text-2xs text-muted transition-colors hover:border-teal-dim hover:text-content disabled:border-teal-dim disabled:text-teal"
                    >
                        {st === 'learning'
                          ? ru
                            ? 'учу'
                            : 'learning'
                          : st === 'known'
                            ? ru
                              ? 'знаю'
                              : 'known'
                            : ru
                              ? 'игнор'
                              : 'ignore'}
                      </button>
                    ))}
                    {e.hasCard && (
                    <button
                      type="button"
                      onClick={() => void removeCard(e)}
                      className="ml-auto rounded-sm px-2 py-0.5 font-mono text-2xs text-muted transition-colors hover:text-coral"
                    >
                      {ru ? '× из повторения' : '× remove'}
                    </button>
                  )}
                  </div>
                </li>
              );
            })}
          </ul>

          {view.length > limit && (
            <button
              type="button"
              onClick={() => setLimit((l) => l + 200)}
              className="mt-4 w-full rounded-md border border-line py-2.5 font-mono text-2xs uppercase tracking-[0.08em] text-teal transition-colors hover:border-teal-dim"
            >
              {ru
                ? `Показать ещё (${view.length - limit})`
                : `Show more (${view.length - limit})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
