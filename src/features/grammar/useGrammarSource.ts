import { useEffect, useState } from 'react';
import { loadCourseIndexOnly } from '@/content/loader';
import { useSearchParams } from 'react-router-dom';

let courseIndex: ReturnType<typeof loadCourseIndexOnly> | null = null;
export function useGrammarSource() {
  const raw = useSearchParams()[0].get('from');
  const source =
    raw === 'reader' || raw === 'progress' || (raw && /^[a-z]\w*\.d\d+$/.test(raw)) ? raw : null;
  const [day, setDay] = useState<{ id: string; href: string } | null>(null);
  useEffect(() => {
    if (!source || source === 'reader' || source === 'progress') return;
    let alive = true;
    courseIndex ??= loadCourseIndexOnly();
    void courseIndex.then(
      (index) => {
        const unit = index.units.find((unit) => unit.dayIds.includes(source));
        if (alive)
          setDay(
            unit
              ? {
                  id: source,
                  href: `/course/${encodeURIComponent(unit.id)}/day/${encodeURIComponent(source)}`,
                }
              : null
          );
      },
      () => {
        courseIndex = null;
        if (alive) setDay(null);
      }
    );
    return () => {
      alive = false;
    };
  }, [source]);
  return { source, dayHref: day?.id === source ? day.href : null };
}
