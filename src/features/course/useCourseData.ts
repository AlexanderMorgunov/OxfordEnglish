import { useEffect, useMemo } from 'react';
import { useContentStore } from '@/content/store';
import { useLearner } from '@/features/learner/store';
import { useUiLang } from '@/features/i18n/uiLang';
import { courseModel } from './model';
import { useCourseNavigation } from './navigation';
import { useCourseProgress } from './useCourseProgress';

export function useCourseData() {
  const content = useContentStore();
  const load = content.load;
  const learner = useLearner();
  const lang = useUiLang((s) => s.lang);
  const work = useCourseNavigation((s) => s.work);
  const progress = useCourseProgress();
  useEffect(() => {
    void load();
  }, [load]);
  const packId = content.pack?.manifest.id;
  useEffect(() => {
    if (packId) useCourseNavigation.getState().prepare(packId);
  }, [packId]);
  const model = useMemo(
    () =>
      content.pack
        ? courseModel(
            content.pack,
            progress.attempts,
            work,
            learner.recommendedUnitId
          )
        : null,
    [content.pack, progress.attempts, work, learner.recommendedUnitId]
  );
  return { ...content, model, learner, progress, lang, ru: lang === 'ru' };
}
