import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { CheckpointResult, ExerciseAttempt } from '@/db/db';
import { useContentStore } from '@/content/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { Card, Eyebrow, PixelImage } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import {
  activeDays,
  currentStreak,
  skillMap,
  type TagStat,
} from '@/features/progress/metrics';
import {
  checkpointHistory,
  loadAttempts,
  vocabSize,
} from '@/features/progress/queries';

const pct = (n: number) => `${Math.round(n * 100)}%`;

function barColor(accuracy: number): string {
  if (accuracy < 0.5) return 'bg-coral';
  if (accuracy < 0.8) return 'bg-amber';
  return 'bg-teal';
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card className="flex-1">
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
    </Card>
  );
}

function SkillRow({ stat }: { stat: TagStat }) {
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="font-mono text-sm text-content">{stat.tag}</span>
        <span className="font-mono text-2xs tabular-nums text-muted">
          {pct(stat.accuracy)} · {stat.correct}/{stat.total}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={cn('h-full rounded-full', barColor(stat.accuracy))}
          style={{ width: pct(stat.accuracy) }}
        />
      </div>
    </div>
  );
}

function ActivityStrip({ days, ru }: { days: Set<string>; ru: boolean }) {
  const today = new Date();
  const cells = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (13 - i));
    return days.has(d.toISOString().slice(0, 10));
  });
  return (
    <div className="flex gap-1">
      {cells.map((active, i) => (
        <div
          key={i}
          className={cn('h-4 w-4 rounded-sm', active ? 'bg-teal' : 'bg-surface-2')}
          title={active ? (ru ? 'активность' : 'active') : ru ? 'нет активности' : 'no activity'}
        />
      ))}
    </div>
  );
}

export function ProgressPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [attempts, setAttempts] = useState<ExerciseAttempt[] | null>(null);
  const [vocab, setVocab] = useState(0);
  const [history, setHistory] = useState<CheckpointResult[]>([]);
  const { pack, load } = useContentStore();

  useEffect(() => {
    void load();
    void loadAttempts().then(setAttempts);
    void vocabSize().then(setVocab);
    void checkpointHistory().then(setHistory);
  }, [load]);

  const exitLevels = (() => {
    if (!pack) return [];
    const counts = new Map<string, number>();
    for (const d of pack.units.flatMap((u) => u.days)) {
      if (d.level) counts.set(d.level, (counts.get(d.level) ?? 0) + 1);
    }
    return [...counts].filter(([, n]) => n >= 5).map(([level]) => level);
  })();

  const map = attempts ? skillMap(attempts) : [];
  const streak = attempts ? currentStreak(attempts, new Date()) : 0;
  const days = attempts ? activeDays(attempts) : new Set<string>();

  return (
    <section aria-label={ru ? 'Прогресс' : 'Progress'}>
      <Eyebrow className="mb-3.5">metrics</Eyebrow>
      <div className="mb-8 flex items-center gap-3">
        <PixelImage src="/assets/pixel/nav/progress.png" alt="" className="h-7 w-7 shrink-0" />
        <h1 className="text-2xl font-bold tracking-tight">{ru ? 'Прогресс' : 'Progress'}</h1>
      </div>

      <div className="mb-8 flex flex-wrap gap-3">
        <Stat label={ru ? 'серия' : 'streak'} value={`${streak}${ru ? 'дн' : 'd'}`} />
        <Stat label={ru ? 'словарь' : 'vocabulary'} value={vocab} />
        <Stat label={ru ? 'дней с занятиями' : 'days active'} value={days.size} />
      </div>

      <div className="mb-8">
        <p className="mb-3 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'активность · последние 14 дней' : 'activity · last 14 days'}
        </p>
        <ActivityStrip days={days} ru={ru} />
      </div>

      <div className="mb-8">
        <p className="mb-3 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
          {ru ? 'карта навыков · слабое первым' : 'skill map · weakest first'}
        </p>
        {map.length === 0 ? (
          <div className="text-center">
            <PixelImage src="/assets/pixel/mascot.png" alt="" className="mx-auto mb-4 h-24 w-24 opacity-90" />
            <p className="text-sm text-muted">
              {ru
                ? 'Пока нет попыток — пройдите практику дня, и слабые места появятся здесь.'
                : "No attempts yet — do a day's practice and your weak spots show up here."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3.5">
            {map.map((stat) => (
              <SkillRow key={stat.tag} stat={stat} />
            ))}
          </div>
        )}
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <p className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
            {ru ? 'контрольные' : 'checkpoints'}
          </p>
          <Link
            to="/checkpoint/u01"
            className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
          >
            {ru ? 'начать юнит 1 →' : 'start unit 1 →'}
          </Link>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-muted">{ru ? 'Контрольных ещё не было.' : 'No checkpoints taken yet.'}</p>
        ) : (
          <div className="flex flex-col gap-2">
            {history.map((h) => (
              <Card key={h.id} className="flex items-center justify-between">
                <span className="font-mono text-sm">{h.unitId}</span>
                <span className="font-mono text-sm tabular-nums text-teal">
                  {h.total > 0 ? pct(h.score / h.total) : '—'} · {h.score}/{h.total}
                </span>
              </Card>
            ))}
          </div>
        )}

        {exitLevels.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {exitLevels.map((level) => (
              <Link
                key={level}
                to={`/checkpoint/exit-${level.toLowerCase()}`}
                className="rounded-sm border border-teal-dim bg-teal-dim/10 px-3 py-1.5 font-mono text-xs text-teal hover:border-teal"
              >
                {ru ? `итоговый тест ${level} →` : `${level} exit test →`}
              </Link>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
