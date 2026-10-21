import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { liveQuery } from 'dexie';
import { db } from '@/db/db';
import {
  dropCard,
  reviewableCards,
} from '@/features/srs/service';
import { Button, Input, PixelImage } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { speakWord } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { TermTranslationLookup } from '@/features/vocab/TermTranslationLookup';
import type { PartOfSpeech } from '@/features/vocab/grammar-metadata';
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
import { VocabularyNav } from '@/features/vocab/VocabularyNav';
import { DictationInput } from '@/features/vocab/DictationInput';
import { WordSensesInput } from '@/features/vocab/WordSensesInput';
import { addSenseTerm } from '@/features/vocab/add-sense-term';
import { RussianTermInput } from '@/features/vocab/RussianTermInput';
import { EnglishDraftSchema, RussianAnswerSchema } from '@/features/vocab/russian-entry';
import { cancelAudioInput } from '@/shared/lib/audio-input';
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
    <div className="px-3 py-1">
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
  const [termRevision, setTermRevision] = useState(0);
  const termInput = useRef<HTMLInputElement>(null);
  const translationInput = useRef<HTMLInputElement>(null);
  const addOpener = useRef<HTMLButtonElement>(null);
  const agreementInput = useRef<HTMLInputElement>(null);
  const [invalidField, setInvalidField] = useState<'term' | 'translation' | 'context' | null>(null);
  const [newTr, setNewTr] = useState('');
  const [newCtx, setNewCtx] = useState('');
  const [senseDraft, setSenseDraft] = useState(false);
  const [sensePos, setSensePos] = useState<PartOfSpeech | undefined>();
  const [inputLanguage, setInputLanguage] = useState<'en' | 'ru'>('en');
  const [reverseDraft, setReverseDraft] = useState(false);
  const [contextAgreed, setContextAgreed] = useState(false);
  const translationRequired = senseDraft || reverseDraft;
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
  const [editRevision, setEditRevision] = useState(0);
  const [savingEntries, setSavingEntries] = useState<Set<string>>(new Set());
  const editSaves = useRef(new Map<string, symbol>());
  const editor = useRef({ key: editKey, revision: editRevision });
  editor.current = { key: editKey, revision: editRevision };
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
      editSaves.current.clear(); setSavingEntries(new Set()); setEditError('');
      setAdding(false);
      setNewTerm('');
      setNewTr('');
      setNewCtx('');
      setSenseDraft(false); setSensePos(undefined); setContextAgreed(false);
      setInputLanguage('en'); setReverseDraft(false);
      setAddError('');
      setInvalidField(null);
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
  const startEdit = (e: LexiconEntry) => {
    setEditError('');
    setEditKey(e.key);
    setDraft(e.translation ?? '');
    setEditRevision(value => value + 1);
  };
  const saveEdit = async (e: LexiconEntry) => {
    if (editSaves.current.has(e.key) || editor.current.key !== e.key) return;
    const current = captureDataScope();
    const version = editor.current.revision;
    const request = Symbol();
    editSaves.current.set(e.key, request);
    setSavingEntries(value => new Set(value).add(e.key));
    const ownsEditor = () => alive.current && current() && editSaves.current.get(e.key) === request &&
      editor.current.key === e.key && editor.current.revision === version;
    try {
      if (!(await setTranslation(e, draft))) throw new Error('Card changed');
      if (!alive.current || !current()) return;
      if (ownsEditor()) setEditKey(null);
      await reload();
    } catch {
      if (!ownsEditor()) return;
      setEditError(
        ru
          ? 'Не удалось сохранить перевод. Обновите карточку и попробуйте ещё раз.'
          : 'Could not save the translation. Refresh the entry and try again.'
      );
    } finally {
      if (editSaves.current.get(e.key) === request) {
        editSaves.current.delete(e.key);
        if (alive.current && current()) setSavingEntries(value => { const next = new Set(value); next.delete(e.key); return next; });
      }
    }
  };
  const addNew = async () => {
    if (!newTerm.trim() || saveLock.current) return;
    if (reverseDraft && (!EnglishDraftSchema.safeParse(newTerm).success || !RussianAnswerSchema.safeParse(newTr).success)) {
      const invalidTerm = !EnglishDraftSchema.safeParse(newTerm).success;
      setInvalidField(invalidTerm ? 'term' : 'translation');
      (invalidTerm ? termInput : translationInput).current?.focus();
      setAddError(ru ? 'Проверьте английское слово или фразу (до 80 символов) и заполните русский перевод (до 120 символов).' : 'Check the English word or phrase (up to 80 characters) and enter its Russian translation (up to 120 characters).');
      return;
    }
    if ((senseDraft || reverseDraft) && (!newTr.trim() || (newCtx.trim() && !contextAgreed))) {
      setInvalidField(!newTr.trim() ? 'translation' : 'context');
      if (!newTr.trim()) translationInput.current?.focus();
      else agreementInput.current?.focus();
      setAddError(ru ? 'Проверьте перевод и подтвердите, что пример соответствует выбранному значению.' : 'Check the translation and confirm that the example matches the chosen meaning.');
      return;
    }
    cancelAudioInput(); setTermRevision(value => value + 1);
    const current = captureDataScope();
    const active = () => alive.current && current();
    const automatic = !newTr.trim();
    saveLock.current = true;
    setSaving(true);
    setAddError('');
    setInvalidField(null);
    try {
      const senseSave = senseDraft || reverseDraft ? await addSenseTerm(newTerm, newTr, newCtx, sensePos) : null;
      const saved = senseSave ? senseSave.state === 'saved' ? senseSave.card : null : await addTerm(newTerm, newTr, newCtx);
      if (!active()) return;
      if (senseSave?.state === 'existing' || senseSave?.state === 'deleted') {
        setAddError(ru ? 'У этого слова уже есть карточка или отметка удаления. Отдельное значение пока сохранить нельзя. Изменить существующую карточку можно в словаре ниже.' : 'This term already has a card or a deletion record. A separate meaning cannot be saved yet. You can edit an existing card in the vocabulary below.');
        return;
      }
      if (!saved) {
        setAddError(ru ? 'Не удалось сохранить. Попробуйте ещё раз.' : 'Could not save. Please try again.');
        return;
      }
      setNewTerm('');
      setNewTr('');
      setNewCtx('');
      setSenseDraft(false); setSensePos(undefined); setContextAgreed(false);
      setInputLanguage('en'); setReverseDraft(false);
      setAdding(false);
      requestAnimationFrame(() => { if (active() && addOpener.current?.isConnected) addOpener.current.focus(); });
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
      <VocabularyNav />
      {editError && (
        <p role="alert" className="mb-3 text-sm text-coral">
          {editError}
        </p>
      )}
      <div className="mb-4 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/vocab.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">{ru ? 'Мой словарь' : 'My vocabulary'}</h1>
      </div>

      <div className="mb-4 flex flex-wrap items-stretch gap-2.5">
        <Stat n={stats.marked} label={ru ? 'отмечено слов' : 'marked words'} />
        <Stat n={stats.cards} label={ru ? 'карточек' : 'cards'} />
        <Link to="/review" className="rounded-sm px-3 py-1 text-teal transition-colors hover:bg-surface-2">
          <p className="font-mono text-xl tabular-nums text-teal">{stats.due}</p>
          <p className="font-mono text-2xs uppercase tracking-[0.08em] text-teal">
            {ru ? 'к повторению →' : 'due → review'}
          </p>
        </Link>
      </div>

      <div className="mb-6">
        {adding ? (
          <form className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-4" onSubmit={(e) => { e.preventDefault(); void addNew(); }}>
            <h2 className="text-lg font-semibold">{ru ? 'Новое слово' : 'New term'}</h2>
            <fieldset disabled={saving} className="min-w-0">
              <legend className="mb-2 text-sm text-muted">{ru ? 'Как добавить слово' : 'How to add a term'}</legend>
              <div className="flex flex-wrap gap-2">
                {(['en', 'ru'] as const).map(language => <Button key={language} variant={inputLanguage === language ? 'primary' : 'ghost'} className="min-h-11" aria-pressed={inputLanguage === language} onClick={() => {
                  if (language === inputLanguage) return;
                  cancelAudioInput(); setTermRevision(value => value + 1); setSensePos(undefined); setInputLanguage(language); setAddError(''); setInvalidField(null);
                  if (language === 'ru') setReverseDraft(true);
                }}>{language === 'en' ? ru ? 'На английском' : 'In English' : ru ? 'С русского' : 'From Russian'}</Button>)}
              </div>
            </fieldset>
            {reverseDraft && <p className="text-xs text-muted">{ru ? 'В карточке сохраняются английское слово и русский перевод. При переключении введённые поля остаются; для обычного добавления с автопереводом очистите черновик.' : 'The card stores an English term and Russian answer. Switching preserves your draft; start over to return to ordinary automatic translation.'}</p>}
            {inputLanguage === 'ru' && <RussianTermInput disabled={saving} draftRevision={termRevision} onChoose={proposal => {
              cancelAudioInput(); setTermRevision(value => value + 1);
              setNewTerm(proposal.english); setSensePos(undefined); setNewTr(proposal.russian); setContextAgreed(false); setAddError(''); setInvalidField(null);
              const current = captureDataScope();
              requestAnimationFrame(() => { if (current() && termInput.current?.isConnected) termInput.current.focus(); });
            }} />}
            <label htmlFor="new-term" className="text-sm text-muted">{ru ? 'Слово или фраза на английском' : 'English word or phrase'}</label>
            <Input
              id="new-term"
              lang="en"
              aria-invalid={invalidField === 'term'}
              aria-describedby={invalidField === 'term' ? 'new-term-error' : undefined}
              ref={termInput}
              disabled={saving}
              placeholder={ru ? 'слово или фраза (англ.)' : 'word or phrase (English)'}
              value={newTerm}
              onChange={(e) => { cancelAudioInput(); setTermRevision(value => value + 1); setNewTerm(e.target.value); setSensePos(undefined); setContextAgreed(false); setInvalidField(null); setAddError(''); }}
              autoFocus
            />
            <TermTranslationLookup term={newTerm} draftRevision={termRevision} disabled={saving} onApply={translation => {
              cancelAudioInput(); setTermRevision(value => value + 1); setNewTr(translation); setSensePos(undefined); setContextAgreed(false); setInvalidField(null); setAddError('');
              requestAnimationFrame(() => translationInput.current?.focus());
            }} />
            <label htmlFor="new-translation" className="text-sm text-muted">{ru ? 'Перевод' : 'Translation'}</label>
            <Input
              id="new-translation"
              lang="ru"
              aria-required={translationRequired}
              aria-invalid={invalidField === 'translation'}
              aria-describedby={`new-translation-help${invalidField === 'translation' ? ' new-term-error' : ''}`}
              ref={translationInput}
              disabled={saving}
              placeholder={translationRequired ? ru ? 'русский перевод (обязательно)' : 'Russian translation (required)' : ru ? 'перевод (необязательно)' : 'translation (optional)'}
              value={newTr}
              onChange={(e) => { cancelAudioInput(); setTermRevision(value => value + 1); setNewTr(e.target.value); setSensePos(undefined); setContextAgreed(false); setInvalidField(null); setAddError(''); }}
            />
            <p id="new-translation-help" className="text-sm text-muted">{translationRequired ? ru ? 'Русский перевод обязателен. Проверьте, что он соответствует нужному значению.' : 'A Russian translation is required. Check that it matches the intended meaning.' : ru ? 'Можно перевести сейчас или сохранить без перевода. Пустой ответ попробуем заполнить после добавления.' : 'Translate now or save without an answer. We will try automatic lookup after adding a blank translation.'}</p>
            <label htmlFor="new-context" className="text-sm text-muted">{ru ? 'Пример или контекст' : 'Example or context'}</label>
            <Input
              id="new-context"
              lang="en"
              disabled={saving}
              placeholder={ru ? 'пример/контекст (необязательно)' : 'example/context (optional)'}
              value={newCtx}
              onChange={(e) => { cancelAudioInput(); setTermRevision(value => value + 1); setNewCtx(e.target.value); setSensePos(undefined); setContextAgreed(false); setInvalidField(null); setAddError(''); }}
            />
            {(senseDraft || reverseDraft) && newCtx.trim() && <label className="flex min-h-11 items-center gap-2 text-sm text-content">
              <input ref={agreementInput} type="checkbox" aria-invalid={invalidField === 'context'} aria-describedby={invalidField === 'context' ? 'new-term-error' : undefined} checked={contextAgreed} disabled={saving} onChange={e => { setContextAgreed(e.target.checked); setInvalidField(null); setAddError(''); }} />
              {ru ? 'Мой пример соответствует выбранному значению' : 'My example matches the chosen meaning'}
            </label>}
            {!saving && <DictationInput key={termRevision} draft={newTerm} onAccept={text => {
              setTermRevision(value => value + 1); setNewTerm(text); setSensePos(undefined); setAddError(''); setContextAgreed(false); setInvalidField(null);
              requestAnimationFrame(() => termInput.current?.focus());
            }} />}
            <WordSensesInput key={`${inputLanguage}:${newTerm}`} term={newTerm} context={newCtx} draftRevision={termRevision} disabled={saving} onChoose={(sense, useExample) => {
              cancelAudioInput(); setTermRevision(value => value + 1);
              setNewTr(sense.translation);
              setSensePos(sense.partOfSpeech);
              if (useExample) setNewCtx(sense.example);
              setSenseDraft(true); setContextAgreed(true); setAddError(''); setInvalidField(null);
              const current = captureDataScope();
              requestAnimationFrame(() => {
                if (current() && translationInput.current?.isConnected) translationInput.current.focus();
              });
            }} />
            {addError && <p id="new-term-error" role="alert" className="text-sm text-coral">{addError}</p>}
            <div className="flex items-center gap-3">
              <Button type="submit" className="min-h-11" disabled={!newTerm.trim() || saving}>
                {saving ? ru ? 'Сохраняем…' : 'Saving…' : ru ? 'Добавить' : 'Add'}
              </Button>
              <Button
                variant="ghost"
                disabled={saving}
                onClick={() => {
                  setAdding(false); setAddError(''); setInvalidField(null);
                  const current = captureDataScope();
                  requestAnimationFrame(() => { if (alive.current && current() && addOpener.current?.isConnected) addOpener.current.focus(); });
                }}
                className="min-h-11"
              >
                {ru ? 'отмена' : 'cancel'}
              </Button>
            </div>
            {(reverseDraft || senseDraft) && <Button variant="ghost" className="min-h-11 self-start" disabled={saving} onClick={() => {
              cancelAudioInput(); setTermRevision(value => value + 1); setNewTerm(''); setNewTr(''); setNewCtx('');
              setSenseDraft(false); setSensePos(undefined); setReverseDraft(false); setContextAgreed(false); setInputLanguage('en'); setAddError(''); setInvalidField(null);
              const current = captureDataScope();
              requestAnimationFrame(() => { if (current() && termInput.current?.isConnected) termInput.current.focus(); });
            }}>{ru ? 'Очистить черновик' : 'Start over'}</Button>}
          </form>
        ) : (
          <button
            ref={addOpener}
            type="button"
            onClick={() => { setAdding(true); setSavedTerm(''); }}
            className="min-h-11 rounded-sm border border-line px-3 py-2 font-mono text-2xs uppercase tracking-[0.08em] text-teal transition-colors hover:border-teal-dim"
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
              aria-label={ru ? 'Поиск в словаре' : 'Search vocabulary'}
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
                    'min-h-11 rounded-sm px-2.5 py-1 font-mono text-2xs uppercase tracking-[0.06em] transition-colors',
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
                      'min-h-11 rounded-sm px-2 py-1 font-mono text-2xs transition-colors',
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
                <li key={e.key} className="min-w-0 border-b border-line py-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <span className="flex min-w-0 flex-wrap items-baseline gap-2">
                      <span className="break-words text-base text-content">{e.display}</span>
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
                    <Button variant="ghost" size="sm" className="min-h-11" aria-expanded={editKey === e.key}
                      aria-label={`${ru ? 'Изменить / перевести' : 'Edit / translate'} ${e.display}`}
                      onClick={() => editKey === e.key ? setEditKey(null) : startEdit(e)}>
                      {ru ? 'Изменить / перевести' : 'Edit / translate'}
                    </Button>
                  </div>
                  {e.translation && <p lang="ru" className="mt-1 break-words text-sm text-content">{e.translation}</p>}
                  {editKey === e.key && <div className="mt-3 min-w-0 space-y-2 border-l-2 border-teal-dim pl-3">
                    <label htmlFor={`translation-${encodeURIComponent(e.key)}`} className="block text-sm text-muted">{ru ? 'Перевод' : 'Translation'}</label>
                    <Input id={`translation-${encodeURIComponent(e.key)}`} lang="ru" value={draft} disabled={savingEntries.has(e.key)}
                      onChange={event => { setDraft(event.target.value); setEditRevision(value => value + 1); setEditError(''); }}
                      onKeyDown={event => {
                        if (event.key === 'Enter') { event.preventDefault(); void saveEdit(e); }
                        if (event.key === 'Escape') setEditKey(null);
                      }} autoFocus />
                    <TermTranslationLookup term={e.display} draftRevision={editRevision} disabled={savingEntries.has(e.key)} onApply={translation => { setDraft(translation); setEditRevision(value => value + 1); }} />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" className="min-h-11" disabled={savingEntries.has(e.key)} onClick={() => void saveEdit(e)}>{savingEntries.has(e.key) ? ru ? 'Сохраняем…' : 'Saving…' : ru ? 'Сохранить перевод' : 'Save translation'}</Button>
                      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setEditKey(null)}>{ru ? 'Отмена' : 'Cancel edit'}</Button>
                    </div>
                  </div>}

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
                      className="min-h-11 rounded-sm border border-line px-2 py-0.5 font-mono text-2xs text-muted transition-colors hover:border-teal-dim hover:text-content disabled:border-teal-dim disabled:text-teal"
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
                      className="ml-auto min-h-11 rounded-sm px-2 py-0.5 font-mono text-2xs text-muted transition-colors hover:text-coral"
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
