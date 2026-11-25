import { useEffect, useState } from 'react';
import { db } from '@/db/db';
import { useUiLang } from '@/features/i18n/uiLang';
import { gameScope, unionDuration } from './storage';
import type { Learning } from './contract';
import './games.css';

export function GameProgress() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [stats, setStats] = useState<{
    minutes: number;
    completed: number;
    independent: number;
  } | null>(null);
  useEffect(() => {
    if (typeof indexedDB === 'undefined') return;
    let current = true;
    const scope = gameScope();
    void db.gameRecords
      .where('owner')
      .equals(scope.owner)
      .toArray()
      .then((rows) => {
        scope.check();
        const events = rows
          .filter((r) => r.kind === 'learning')
          .map((r) => ({
            game: r.gameId,
            ...(r.value as { event: Learning; ts: number }),
          }))
          .sort(
            (a, b) =>
              a.ts - b.ts || a.event.eventId.localeCompare(b.event.eventId)
          );
        const first = new Map<string, Learning>();
        for (const { game, event } of events) {
          const key = JSON.stringify([
            game,
            event.activityId,
            event.itemVersion,
          ]);
          const previous = first.get(key);
          if (!previous || event.attemptNumber < previous.attemptNumber)
            first.set(key, event);
        }
        if (current && rows.length)
          setStats({
            minutes: Math.floor(
              unionDuration(
                rows
                  .filter((r) => r.kind === 'time')
                  .map((r) => r.value as { start: number; end: number })
              ) / 60000
            ),
            completed: first.size,
            independent: [...first.values()].filter(
              (e) =>
                e.attemptNumber === 1 && e.correct && !e.usedHint && !e.usedAI
            ).length,
          });
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, []);
  if (!stats) return null;
  return (
    <section className="game-stats" aria-label={ru ? 'Игры' : 'Games'}>
      <h2>{ru ? 'Практика в играх' : 'Game practice'}</h2>
      <p>
        {ru
          ? `${stats.minutes} мин · ${stats.completed} заданий · ${stats.independent} верных первых ответов без помощи`
          : `${stats.minutes} min · ${stats.completed} activities · ${stats.independent} correct first answers without help`}
      </p>
      <small>
        {ru
          ? 'На этом устройстве, за всё время. Результаты сообщает игра; это не оценка владения языком.'
          : 'On this device, all time. Results are reported by games, not a language proficiency assessment.'}
      </small>
    </section>
  );
}
