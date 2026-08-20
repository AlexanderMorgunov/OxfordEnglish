import type { Level } from '@/content/schema';

export const LEVEL_ORDER: Level[] = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];

/** Short CEFR band names for level dividers. */
export const LEVEL_NAME: Record<Level, { ru: string; en: string }> = {
  A1: { ru: 'начальный', en: 'Beginner' },
  A2: { ru: 'элементарный', en: 'Elementary' },
  B1: { ru: 'средний', en: 'Intermediate' },
  B2: { ru: 'выше среднего', en: 'Upper-Intermediate' },
  C1: { ru: 'продвинутый', en: 'Advanced' },
  C2: { ru: 'владение', en: 'Proficiency' },
};
