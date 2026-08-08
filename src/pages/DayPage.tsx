import { useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { useContentStore } from '@/content/store';
import { PracticeSectionView } from '@/features/practice/PracticeSectionView';
import { GrammarSectionView } from '@/features/learn/GrammarSectionView';
import { ReadingSectionView } from '@/features/learn/ReadingSectionView';
import { ListeningSectionView } from '@/features/listen/ListeningSectionView';
import { Eyebrow, PageStub } from '@/shared/ui';

const SECTION_LABEL: Record<string, string> = {
  grammar: 'grammar',
  reading: 'reading',
  listening: 'listening',
  practice: 'practice',
};

export function DayPage() {
  const { dayId } = useParams();
  const { status, pack, load } = useContentStore();

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <article>
      <Eyebrow className="mb-3.5">learning day · {day.id}</Eyebrow>
      <h1 className="mb-10 text-2xl font-bold tracking-tight text-balance">
        {day.title.en}
      </h1>

      <div className="flex flex-col gap-12">
        {day.sections.map((section) => (
          <section key={section.id} aria-label={section.title.en}>
            <div className="mb-4 flex items-baseline gap-3 border-b border-line pb-2">
              <span className="font-mono text-sm text-amber">
                {SECTION_LABEL[section.type] ?? section.type}
              </span>
              <h2 className="text-xl font-semibold tracking-tight">
                {section.title.en}
              </h2>
            </div>
            {section.type === 'grammar' ? (
              <GrammarSectionView section={section} />
            ) : section.type === 'reading' ? (
              <ReadingSectionView section={section} />
            ) : section.type === 'listening' ? (
              <ListeningSectionView section={section} />
            ) : (
              <PracticeSectionView section={section} />
            )}
          </section>
        ))}
      </div>
    </article>
  );
}
