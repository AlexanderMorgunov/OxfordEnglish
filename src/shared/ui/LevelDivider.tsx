import type { Level } from '@/content/schema';
import { LEVEL_NAME } from '@/shared/levels';

/** A labelled CEFR band separator, e.g. "A1 · начальный ————". */
export function LevelDivider({ level, ru }: { level: Level; ru: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className="rounded-sm bg-teal/15 px-2 py-1 font-mono text-sm font-semibold text-teal">
        {level}
      </span>
      <span className="font-mono text-2xs uppercase tracking-[0.14em] text-muted">
        {ru ? LEVEL_NAME[level].ru : LEVEL_NAME[level].en}
      </span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
