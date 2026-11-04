import { THEMES } from '@/features/appearance/themes';
import type { ThemeId } from '@/features/appearance/themes';
import { UI_TEXT_SIZES } from '@/features/appearance/store';

export function WelcomeSetup({
  ru,
  theme,
  textStep,
  chooseTheme,
  chooseSize,
}: {
  ru: boolean;
  theme: ThemeId;
  textStep: number;
  chooseTheme: (theme: ThemeId) => void;
  chooseSize: (step: number) => void;
}) {
  const changeSize = (step: number) =>
    chooseSize(Math.max(0, Math.min(UI_TEXT_SIZES.length - 1, step)));
  return (
    <>
      <p className="fw-lead fw-setup-lead">
        {ru
          ? 'Изменить можно в настройках.'
          : 'You can change this in settings.'}
      </p>
      <div className="fw-setup-grid">
        <div>
          <fieldset>
            <legend>{ru ? 'Тема приложения' : 'App theme'}</legend>
            <div className="fw-themes">
              {THEMES.map((t) => (
                <label className="fw-theme" key={t.id}>
                  <input
                    type="radio"
                    name="welcome-theme"
                    value={t.id}
                    checked={theme === t.id}
                    onChange={() => chooseTheme(t.id)}
                  />
                  <span className="fw-theme-face">
                    <span
                      className="fw-theme-mini"
                      data-theme={t.id}
                      aria-hidden="true"
                    >
                      <i />
                      <i />
                      <b />
                    </span>
                    <span>{t[ru ? 'ru' : 'en']}</span>
                  </span>
                  <span className="fw-theme-check" aria-hidden="true">
                    ✓
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          <section className="fw-size">
            <div>
              <label htmlFor="welcome-text-size">
                {ru ? 'Размер текста' : 'Text size'}
              </label>
              <output htmlFor="welcome-text-size">
                {UI_TEXT_SIZES[textStep]}%
              </output>
            </div>
            <div>
              <button
                type="button"
                aria-label={ru ? 'Уменьшить текст' : 'Decrease text size'}
                disabled={textStep === 0}
                onClick={() => changeSize(textStep - 1)}
              >
                A−
              </button>
              <input
                id="welcome-text-size"
                type="range"
                min={0}
                max={UI_TEXT_SIZES.length - 1}
                step={1}
                value={textStep}
                aria-valuetext={`${UI_TEXT_SIZES[textStep]}%`}
                onChange={(event) => changeSize(Number(event.target.value))}
              />
              <button
                type="button"
                aria-label={ru ? 'Увеличить текст' : 'Increase text size'}
                disabled={textStep === UI_TEXT_SIZES.length - 1}
                onClick={() => changeSize(textStep + 1)}
              >
                A+
              </button>
            </div>
            <p>
              {ru
                ? 'Текст книги настраивается отдельно.'
                : 'Adjust book text separately in the reader.'}
            </p>
          </section>
        </div>
        <aside
          className="fw-preview"
          aria-label={ru ? 'Пример оформления' : 'Appearance preview'}
        >
          <span className="fw-eyebrow">
            {ru ? 'Так будет выглядеть' : 'Your new look'}
          </span>
          <h3>{ru ? 'Новый день, новые слова.' : 'A new day, new words.'}</h3>
          <p>
            {ru
              ? 'Немного практики в удобном ритме.'
              : 'A little practice at your own pace.'}
          </p>
          <div className="fw-question">
            <b>A little every day.</b>
            <span>{ru ? 'немного каждый день' : 'a small step every day'}</span>
          </div>
          <small>
            {ru
              ? 'Настоящий размер текста интерфейса'
              : 'Actual interface text size'}
          </small>
        </aside>
      </div>
    </>
  );
}
