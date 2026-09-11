import { useEffect, useMemo, useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import type { ActivityDay, ReviewLogEntry } from '@/db/db';
import { periodRange, summarize, type Period } from './accounting';
import { loadActivity, statsSince } from './activity';

const PERIODS: { id: Period; ru: string; en: string }[] = [
  { id: 'day', ru: 'день', en: 'day' },
  { id: 'week', ru: 'неделя', en: 'week' },
  { id: 'month', ru: 'месяц', en: 'month' },
  { id: 'year', ru: 'год', en: 'year' },
];

function duration(sec: number, ru: boolean): string {
  const min = Math.round(sec / 60);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return ru ? `${m} мин` : `${m}m`;
  return ru ? `${h} ч ${m} мин` : `${h}h ${m}m`;
}

function Tile({ label, value, note }: { label: string; value: string | number; note?: string }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2.5">
      <p className="font-mono text-xl tabular-nums text-content">{value}</p>
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">{label}</p>
      {note && <p className="mt-0.5 font-mono text-2xs text-teal">{note}</p>}
    </div>
  );
}

/** «Чтение и слова»: active reading time, words read/saved, reviews and words marked known, per period. */
export function ReadingStats() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [period, setPeriod] = useState<Period>('week');
  const [data, setData] = useState<{ rows: ActivityDay[]; reviews: ReviewLogEntry[] } | null>(null);
  const [since, setSince] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void loadActivity(periodRange('year', Date.now()).from).then(async (d) => {
      const first = await statsSince();
      if (!alive) return;
      setData(d);
      setSince(first);
    });
    return () => {
      alive = false;
    };
  }, []);

  const s = useMemo(() => (data ? summarize(data.rows, data.reviews, period, Date.now()) : null), [data, period]);
  const locale = ru ? 'ru-RU' : 'en-US';
  const maxBar = s ? Math.max(1, ...s.bars.map((b) => b.sec)) : 1;
  const barLabel = (key: string) =>
    period === 'year'
      ? new Date(`${key}-01T00:00:00`).toLocaleDateString(locale, { month: 'short' })
      : new Date(`${key}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
  const empty = !s || (s.readSec === 0 && s.readWords === 0 && s.wordsSaved === 0 && s.phrasesSaved === 0 && s.reviews === 0 && s.learned === 0);

  return (
    <div className="mb-8">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'чтение и слова' : 'reading & words'}
        </p>
        <div role="group" aria-label={ru ? 'Период' : 'Period'} className="flex gap-1">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => setPeriod(p.id)}
              className={cn(
                'rounded-sm px-2 py-1 font-mono text-2xs hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
                period === p.id ? 'bg-surface-2 text-teal' : 'text-muted'
              )}
            >
              {ru ? p.ru : p.en}
            </button>
          ))}
        </div>
      </div>

      {s && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
          <Tile label={ru ? 'время чтения' : 'reading time'} value={duration(s.readSec, ru)} />
          <Tile label={ru ? 'прочитано слов' : 'words read'} value={s.readWords} />
          <Tile label={ru ? 'добавлено слов' : 'words saved'} value={s.wordsSaved} />
          <Tile label={ru ? 'добавлено фраз' : 'phrases saved'} value={s.phrasesSaved} />
          <Tile
            label={ru ? 'повторений' : 'reviews'}
            value={s.reviews}
            note={s.reviews ? `${ru ? 'помню' : 'recalled'} ${Math.round((s.recalled / s.reviews) * 100)}%` : undefined}
          />
          <Tile label={ru ? 'отмечено «знаю»' : 'marked known'} value={s.learned} />
        </div>
      )}

      {s && period !== 'day' && s.readSec > 0 && (
        <div className="mb-4">
          <div
            role="img"
            aria-label={ru ? 'Минуты чтения по периодам' : 'Reading minutes over the period'}
            className="flex h-20 items-end gap-0.5"
          >
            {s.bars.map((b) => (
              <div
                key={b.key}
                title={`${barLabel(b.key)}: ${duration(b.sec, ru)}`}
                className={cn('min-h-px flex-1 rounded-t-sm', b.sec ? 'bg-teal' : 'bg-surface-2')}
                style={{ height: `${Math.max(4, (b.sec / maxBar) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1 flex justify-between font-mono text-2xs text-muted">
            <span>{barLabel(s.bars[0]!.key)}</span>
            <span>{barLabel(s.bars.at(-1)!.key)}</span>
          </div>
        </div>
      )}

      {s && s.books.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label={ru ? 'Книги за период' : 'Books this period'}>
          {s.books.map((b) => (
            <li key={b.key} className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 truncate text-content">{b.title}</span>
              <span className="font-mono text-2xs tabular-nums text-muted">
                {duration(b.sec, ru)} · {b.words} {ru ? 'сл.' : 'words'}
                {b.saved > 0 && ` · +${b.saved}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {empty && (
        <p className="text-sm text-pretty text-muted">
          {since
            ? ru
              ? `За этот период пусто. Статистика собирается с ${new Date(`${since}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}.`
              : `Nothing in this period. Stats are collected since ${new Date(`${since}T00:00:00`).toLocaleDateString(locale, { day: 'numeric', month: 'long' })}.`
            : ru
              ? 'Статистика появится, когда вы почитаете книгу или повторите слова.'
              : 'Stats appear once you read a book or review words.'}
        </p>
      )}
    </div>
  );
}
