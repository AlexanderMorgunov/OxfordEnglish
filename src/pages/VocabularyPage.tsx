import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '@/db/db';
import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { canSpeak, speakWord } from '@/shared/lib/audio';
import { translateWord } from '@/features/vocab/translate';
import { useVocabStore } from '@/features/vocab/vocabStore';
import {
  buildLexicon,
  matchesFilter,
  sortLexicon,
  type LexiconEntry,
  type LexiconFilter,
  type LexiconSort,
} from '@/features/vocab/lexicon';

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
  const ru = useUiLang((s) => s.lang) === 'ru';
  const updateStatus = useVocabStore((s) => s.updateStatus);

  const [entries, setEntries] = useState<LexiconEntry[] | null>(null);
  const [stats, setStats] = useState({ marked: 0, cards: 0, due: 0 });
  const [filter, setFilter] = useState<LexiconFilter>('all');
  const [sort, setSort] = useState<LexiconSort>('recent');
  const [q, setQ] = useState('');

  const reload = useCallback(async () => {
    try {
      const [statuses, cards, translations] = await Promise.all([
        db.wordStatus.toArray(),
        db.srsCards.toArray(),
        db.translations.toArray(),
      ]);
      const now = Date.now();
      const live = cards.filter((c) => !c.fromError);
      setStats({
        marked: statuses.filter((s) => s.status === 'known' || s.status === 'learning').length,
        cards: live.length,
        due: live.filter((c) => (c.due instanceof Date ? c.due : new Date(c.due)).getTime() <= now).length,
      });
      setEntries(buildLexicon({ statuses, cards, translations }));
    } catch {
      setEntries([]);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const view = useMemo(() => {
    if (!entries) return [];
    const needle = q.trim().toLowerCase();
    let v = entries.filter((e) => matchesFilter(e, filter));
    if (needle) {
      v = v.filter(
        (e) => e.display.toLowerCase().includes(needle) || e.translation?.toLowerCase().includes(needle)
      );
    }
    return sortLexicon(v, sort);
  }, [entries, filter, q, sort]);

  const changeStatus = async (e: LexiconEntry, status: 'learning' | 'known' | 'ignored') => {
    await updateStatus(e.display, status);
    await reload();
  };
  const removeCard = async (e: LexiconEntry) => {
    if (!e.cardId) return;
    try {
      await db.srsCards.delete(e.cardId);
    } catch {
      // best-effort
    }
    await reload();
  };
  const translateOne = async (e: LexiconEntry) => {
    const ruText = await translateWord(e.display);
    if (ruText) setEntries((prev) => prev?.map((x) => (x.key === e.key ? { ...x, translation: ruText } : x)) ?? prev);
  };

  return (
    <section aria-label={ru ? 'Словарь' : 'Vocabulary'}>
      <Eyebrow className="mb-3.5">lexicon</Eyebrow>
      <h1 className="mb-6 text-2xl font-bold tracking-tight">{ru ? 'Мой словарь' : 'My vocabulary'}</h1>

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

      {entries !== null && entries.length === 0 ? (
        <div className="rounded-lg border border-line bg-surface p-5">
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
            {view.map((e) => (
              <li key={e.key} className="rounded-md border border-line bg-surface px-4 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <span className="flex items-baseline gap-2">
                    <span className="text-base text-content">{e.display}</span>
                    {canSpeak() && (
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
                  </span>
                  <span className="text-sm text-muted">
                    {e.translation ? (
                      e.translation
                    ) : (
                      <button
                        type="button"
                        onClick={() => void translateOne(e)}
                        className="font-mono text-2xs text-teal hover:underline"
                      >
                        {ru ? '— перевести' : '— translate'}
                      </button>
                    )}
                  </span>
                </div>

                {e.context && (
                  <p className="mt-1.5 border-l-2 border-line pl-2 text-sm text-muted text-pretty">{e.context}</p>
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
                      {st === 'learning' ? (ru ? 'учу' : 'learning') : st === 'known' ? (ru ? 'знаю' : 'known') : (ru ? 'игнор' : 'ignore')}
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
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
