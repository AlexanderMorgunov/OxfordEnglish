import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useContentStore } from '@/content/store';
import { PracticeSectionView } from '@/features/practice/PracticeSectionView';
import { GrammarSectionView } from '@/features/learn/GrammarSectionView';
import { ReadingSectionView } from '@/features/learn/ReadingSectionView';
import { VocabularySectionView } from '@/features/learn/VocabularySectionView';
import { ListeningSectionView } from '@/features/listen/ListeningSectionView';
import { DaySummary, type NextDay } from '@/features/learn/DaySummary';
import { loadAttempts } from '@/features/progress/queries';
import { resultsFromAttempts, dayExercises } from '@/features/progress/completion';
import { useSessionResults } from '@/features/progress/sessionResults';
import { Eyebrow, PageStub, PixelImage } from '@/shared/ui';
import type { LoadedPack } from '@/content/loader';

function nextDayOf(pack: LoadedPack, dayId: string): NextDay | null {
  const ordered = pack.units.flatMap((u) => u.days.map((d) => ({ unitId: u.id, day: d })));
  const idx = ordered.findIndex((o) => o.day.id === dayId);
  const nxt = idx >= 0 ? ordered[idx + 1] : undefined;
  return nxt ? { unitId: nxt.unitId, dayId: nxt.day.id, title: nxt.day.title.en } : null;
}

/** unitId when `dayId` is the LAST day of its unit — the point to offer a checkpoint. */
function unitCheckpointOf(pack: LoadedPack, dayId: string): string | null {
  const unit = pack.units.find((u) => u.days.some((d) => d.id === dayId));
  const last = unit?.days[unit.days.length - 1];
  return last && last.id === dayId ? unit.id : null;
}

/** A level needs a real tier's worth of days before an exit test is meaningful. */
const MIN_EXIT_DAYS = 5;

/** level when `dayId` is the LAST day of its level — the point to offer an exit test. */
function levelExitOf(pack: LoadedPack, dayId: string): string | null {
  const all = pack.units.flatMap((u) => u.days);
  const day = all.find((d) => d.id === dayId);
  if (!day?.level) return null;
  const sameLevel = all.filter((d) => d.level === day.level);
  if (sameLevel.length < MIN_EXIT_DAYS) return null;
  const last = sameLevel[sameLevel.length - 1];
  return last && last.id === dayId ? day.level : null;
}

const SECTION_LABEL: Record<string, string> = {
  grammar: 'grammar',
  vocabulary: 'vocabulary',
  reading: 'reading',
  listening: 'listening',
  practice: 'practice',
};

export function DayPage() {
  const { dayId } = useParams();
  const { status, pack, load } = useContentStore();
  const hydrate = useSessionResults((s) => s.hydrate);
  const resetResults = useSessionResults((s) => s.reset);
  const [runKey, setRunKey] = useState(0);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadAttempts().then((attempts) => hydrate(resultsFromAttempts(attempts)));
  }, [hydrate]);

  if (status === 'idle' || status === 'loading') {
    return <p className="font-mono text-sm text-muted">loading day…</p>;
  }

  const day = dayId ? pack?.days.get(dayId) : undefined;
  if (!day) {
    return (
      <PageStub eyebrow="404" title="Day not found">
        No day with id <code className="font-mono text-amber">{dayId}</code> in the
        loaded pack.
      </PageStub>
    );
  }

  const redo = () => {
    resetResults(dayExercises(day).map((e) => e.id));
    setRunKey((k) => k + 1);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <article>
      <Eyebrow className="mb-3.5">learning day · {day.id}</Eyebrow>
      <h1 className="mb-10 text-2xl font-bold tracking-tight text-balance">
        {day.title.en}
      </h1>

      <div className="flex flex-col gap-12">
        {day.sections.map((section) => (
          <section key={`${section.id}.${runKey}`} aria-label={section.title.en}>
            <div className="mb-4 flex items-center gap-2.5 border-b border-line pb-2">
              <PixelImage
                src={`/assets/pixel/sections/${section.type}.png`}
                alt=""
                className="h-6 w-6 shrink-0"
              />
              <span className="font-mono text-sm text-amber">
                {SECTION_LABEL[section.type] ?? section.type}
              </span>
              <h2 className="text-xl font-semibold tracking-tight">
                {section.title.en}
              </h2>
            </div>
            {section.type === 'grammar' ? (
              <GrammarSectionView section={section} />
            ) : section.type === 'vocabulary' ? (
              <VocabularySectionView section={section} />
            ) : section.type === 'reading' ? (
              <ReadingSectionView section={section} />
            ) : section.type === 'listening' ? (
              <ListeningSectionView section={section} />
            ) : (
              <PracticeSectionView section={section} />
            )}
          </section>
        ))}

        <DaySummary
          day={day}
          next={pack ? nextDayOf(pack, day.id) : null}
          checkpointUnitId={pack ? unitCheckpointOf(pack, day.id) : null}
          levelExitId={pack ? levelExitOf(pack, day.id) : null}
          onRedo={redo}
        />
      </div>
    </article>
  );
}
