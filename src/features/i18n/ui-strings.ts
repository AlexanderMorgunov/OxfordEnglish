import type { UiLang } from './uiLang';

/** UI labels repeated across several exercise/section components — the en/ru pair lives once here so
 *  it can't drift. Per-component one-offs (placeholders, bespoke feedback) stay inline. */
export function exLabels(lang: UiLang) {
  const ru = lang === 'ru';
  return {
    runCheck: ru ? 'Проверить' : 'Run check',
    reset: ru ? 'Сброс' : 'Reset',
    reveal: ru ? 'показать' : 'reveal',
    addReview: ru ? '+ в повторение' : '+ review',
    inReview: ru ? '✓ в повторении' : '✓ in review',
    hint: ru ? 'подсказка' : 'hint',
  };
}
