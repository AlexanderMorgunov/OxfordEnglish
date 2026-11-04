import { useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { Button, PixelImage } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { THEMES, isTheme, useTheme } from './themes';
import type { ThemeId } from './themes';
import './appearance.css';

function ThemeMini({ theme }: { theme: ThemeId }) {
  return (
    <span className="theme-mini" data-theme={theme} aria-hidden="true">
      <span className="theme-mini-top">•••</span>
      <span className="theme-mini-line" />
      <span className="theme-mini-card">
        <i />
        <b />
      </span>
      <span className="theme-mini-path">
        <i>✓</i>
        <b>2</b>
        <i>3</i>
      </span>
    </span>
  );
}

function ThemeDialog({
  initial,
  onClose,
  onApplied,
}: {
  initial: ThemeId;
  onClose: () => void;
  onApplied: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { theme, draft, preview, apply, error } = useTheme();
  useLayoutEffect(() => {
    useTheme.getState().preview(initial);
    return () => useTheme.getState().cancel();
  }, [initial]);
  const selected = THEMES.find((t) => t.id === (draft ?? initial))!;
  return (
    <Dialog
      title={ru ? 'Выберите тему' : 'Choose a theme'}
      size="wide"
      onClose={onClose}
      footer={
        <>
          <p className="theme-current">
            {ru ? 'Текущая тема — ' : 'Current theme — '}
            {THEMES.find((t) => t.id === theme)![ru ? 'ru' : 'en']}
          </p>
          <Button variant="ghost" onClick={onClose}>
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
          <Button
            onClick={() => {
              if (apply()) {
                onApplied();
                onClose();
              }
            }}
          >
            {error
              ? ru
                ? 'Повторить сохранение'
                : 'Retry saving'
              : ru
                ? 'Применить'
                : 'Apply'}
          </Button>
        </>
      }
    >
      <p className="theme-intro">
        {ru
          ? 'Сохраните выбор кнопкой «Применить».'
          : 'Use Apply to save your choice.'}
      </p>
      {error && (
        <p className="theme-error" role="alert">
          {ru
            ? 'Не удалось сохранить тему на устройстве. Можно повторить или отменить изменения.'
            : 'Could not save the theme on this device. Retry or cancel the changes.'}
        </p>
      )}
      <div className="theme-picker-layout">
        <fieldset className="theme-options">
          <legend>{ru ? 'Выберите оформление' : 'Choose a theme'}</legend>
          {THEMES.map((t) => (
            <label
              key={t.id}
              className="theme-option"
              data-selected={selected.id === t.id}
            >
              <input
                type="radio"
                name="appearance-theme"
                value={t.id}
                checked={selected.id === t.id}
                onChange={() => preview(t.id)}
              />
              <ThemeMini theme={t.id} />
              <span className="theme-option-name">
                {t[ru ? 'ru' : 'en']}
                <span aria-hidden="true">
                  {selected.id === t.id ? '✓' : ''}
                </span>
              </span>
              <span className="theme-note">{t[ru ? 'noteRu' : 'noteEn']}</span>
            </label>
          ))}
        </fieldset>
        <div
          className="theme-preview"
          aria-label={ru ? 'Предпросмотр темы' : 'Theme preview'}
        >
          <p className="theme-note">{ru ? 'ПРЕДПРОСМОТР' : 'PREVIEW'}</p>
          <h3>{selected[ru ? 'ru' : 'en']}</h3>
          <p>{selected[ru ? 'descriptionRu' : 'descriptionEn']}</p>
          <div className="theme-preview-page" aria-hidden="true">
            <h4>
              {ru ? 'Сегодня' : 'Today'} <span>A2</span>
            </h4>
            <p>{ru ? 'Английский, день за днём.' : 'English, day by day.'}</p>
            <div className="theme-preview-work">
              <p>{ru ? 'Ваш рабочий день' : 'Your current day'}</p>
              <strong>{ru ? 'Один небольшой шаг' : 'One small step'}</strong>
              <div className="theme-preview-action">
                {ru ? 'Продолжить день' : 'Continue your day'} <span>→</span>
              </div>
            </div>
            <div className="theme-preview-path">
              <span>✓</span>
              <b>2</b>
              <span>3</span>
            </div>
          </div>
          <p className="theme-note">
            {ru
              ? 'Меняются цвета. Ваш маршрут и прогресс остаются на месте.'
              : 'Only the colours change. Your path and progress stay in place.'}
          </p>
        </div>
      </div>
    </Dialog>
  );
}

export function AppearanceThemes({
  placement,
}: {
  placement: 'settings' | 'today';
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const { theme, dismissed, dismiss } = useTheme();
  const [params, setParams] = useSearchParams();
  const [notice, setNotice] = useState<'saved' | 'dismiss-error' | null>(null);
  const requested = params.get('theme');
  const open = isTheme(requested);
  const choose = (id: ThemeId, button: HTMLButtonElement) => {
    button.focus({ preventScroll: true });
    setNotice(null);
    const next = new URLSearchParams(params);
    next.set('theme', id);
    setParams(next, { preventScrollReset: true });
  };
  const close = () => {
    const next = new URLSearchParams(params);
    next.delete('theme');
    setParams(next, { replace: true, preventScrollReset: true });
  };
  const name = THEMES.find((t) => t.id === theme)![ru ? 'ru' : 'en'];
  return (
    <>
      {placement === 'settings' ? (
        <section
          className="appearance-settings"
          aria-labelledby="appearance-heading"
        >
          <div className="appearance-heading">
            <div>
              <h3 id="appearance-heading">
                {ru ? 'Ваше настроение — ваша тема' : 'Your mood, your theme'}
              </h3>
              <p>
                {ru
                  ? `Сейчас: ${name}. Можно примерить другую.`
                  : `Now: ${name}. Try a different look.`}
              </p>
            </div>
            <Button onClick={(e) => choose(theme, e.currentTarget)}>
              {ru ? 'Изменить тему' : 'Change theme'}
            </Button>
          </div>
          <div className="appearance-swatches">
            {THEMES.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-label={`${ru ? 'Примерить тему' : 'Try theme'} ${t[ru ? 'ru' : 'en']}`}
                aria-pressed={theme === t.id}
                onClick={(e) => choose(t.id, e.currentTarget)}
              >
                <ThemeMini theme={t.id} />
                <span>
                  {t[ru ? 'ru' : 'en']}
                  <span aria-hidden="true">{theme === t.id ? ' ✓' : ''}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="theme-note">
            {ru
              ? 'Сохраняется на этом устройстве. Размер текста книги настраивается отдельно в читалке.'
              : 'Saved on this device. Adjust book text size separately in the reader.'}
          </p>
        </section>
      ) : (
        !dismissed && (
          <aside className="appearance-invitation">
            <PixelImage
              src="/assets/pixel/nav/settings.png"
              alt=""
              className="h-8 w-8 shrink-0"
            />
            <div>
              <h2>
                {ru ? 'DayEnglish в вашем стиле' : 'DayEnglish, your style'}
              </h2>
              <p>
                {ru
                  ? 'Пять тем для вашего настроения.'
                  : 'Five themes to suit your mood.'}
              </p>
            </div>
            <Button
              variant="ghost"
              onClick={(e) => choose(theme, e.currentTarget)}
            >
              {ru ? 'Выбрать тему' : 'Choose a theme'}
            </Button>
            <button
              className="appearance-dismiss"
              type="button"
              aria-label={
                ru
                  ? 'Скрыть предложение выбрать тему'
                  : 'Dismiss the theme invitation'
              }
              onClick={() => {
                setNotice(dismiss() ? null : 'dismiss-error');
              }}
            >
              ×
            </button>
          </aside>
        )
      )}
      {notice && (
        <p
          className={notice === 'saved' ? 'theme-notice' : 'theme-error'}
          role="status"
        >
          {notice === 'saved'
            ? ru
              ? `Тема «${name}» сохранена.`
              : `${name} theme saved.`
            : ru
              ? 'Не удалось сохранить выбор. Попробуйте закрыть предложение ещё раз.'
              : 'Could not save your choice. Try dismissing the invitation again.'}
        </p>
      )}
      {open && (
        <ThemeDialog
          initial={requested}
          onClose={close}
          onApplied={() => setNotice('saved')}
        />
      )}
    </>
  );
}
