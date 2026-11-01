import { useId, useLayoutEffect, useRef, useState, useEffect } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { THEMES, useTheme } from '@/features/appearance/themes';
import {
  cancelSpeech,
  listEnglishVoices,
  previewVoice,
  subscribeVoices,
} from '@/shared/lib/audio';
import type { Voice } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { ReaderTextSize } from './ReaderTextSize';
import { ReaderIcon } from './ReaderIcon';
import {
  DEFAULT_BOOK_FONT_STEP,
  effectiveReaderFontStep,
  useReaderSettings,
} from './settings';
import type { ReaderAppearanceValues } from './settings';
import { keepReadingAnchor } from './reading-anchor';
import './reader-controls.css';

const VOICE_SAMPLE = 'A little practice every day makes reading easier.';

function appearanceValues(): ReaderAppearanceValues {
  const {
    coloring,
    fontStep,
    fontStepExplicit,
    fontFamily,
    lineStep,
    voiceURI,
  } = useReaderSettings.getState();
  return {
    coloring,
    fontStep,
    fontStepExplicit,
    fontFamily,
    lineStep,
    voiceURI,
  };
}

export function ReaderAppearance({
  open,
  onClose,
  returnFocus,
  onBeforeVoicePreview,
  defaultFontFamily = 'serif',
}: {
  open: boolean;
  onClose: () => void;
  returnFocus: () => HTMLElement | null;
  onBeforeVoicePreview?: () => void;
  defaultFontFamily?: 'serif' | 'sans';
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const available = useSpeechAvailable();
  const ref = useRef<HTMLDialogElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const snapshot = useRef<ReaderAppearanceValues | null>(null);
  const previewingVoice = useRef(false);
  const [voicePreviewActive, setVoicePreviewActive] = useState(false);
  const previousStorageError = useRef(false);
  const callbacks = useRef({ onClose, returnFocus, onBeforeVoicePreview });
  callbacks.current = { onClose, returnFocus, onBeforeVoicePreview };
  const title = useId();
  const fontId = useId();
  const lineId = useId();
  const voiceId = useId();
  const savedFontStep = useReaderSettings((s) => s.fontStep);
  const fontStepExplicit = useReaderSettings((s) => s.fontStepExplicit);
  const fontStep = effectiveReaderFontStep(
    savedFontStep,
    fontStepExplicit,
    true
  );
  const fontFamily = useReaderSettings((s) => s.fontFamily);
  const lineStep = useReaderSettings((s) => s.lineStep);
  const coloring = useReaderSettings((s) => s.coloring);
  const voiceURI = useReaderSettings((s) => s.voiceURI);
  const [voices, setVoices] = useState<Voice[]>(() => listEnglishVoices());
  const [error, setError] = useState(false);
  const theme = useTheme((s) => s.draft ?? s.theme);

  useEffect(() => {
    const sync = () => setVoices(listEnglishVoices());
    sync();
    return subscribeVoices(sync);
  }, []);

  const restore = () => {
    if (previewingVoice.current) cancelSpeech();
    previewingVoice.current = false;
    if (!snapshot.current) return;
    snapshot.current = null;
    keepReadingAnchor(() => {
      useReaderSettings.getState().cancelAppearancePreview();
      useReaderSettings.setState({
        storageError: previousStorageError.current,
      });
      useTheme.getState().cancel();
    });
  };
  const restoreRef = useRef(restore);
  restoreRef.current = restore;

  useLayoutEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !snapshot.current) {
      snapshot.current = appearanceValues();
      useReaderSettings.getState().beginAppearancePreview();
      previousStorageError.current = useReaderSettings.getState().storageError;
      setError(false);
      setVoicePreviewActive(false);
      if (!dialog.open) dialog.showModal();
      headingRef.current?.focus({ preventScroll: true });
    }
    if (!open && dialog.open) {
      restoreRef.current();
      dialog.close();
      callbacks.current.returnFocus()?.focus({ preventScroll: true });
    }
  }, [open]);
  useEffect(() => () => restoreRef.current(), []);

  const dismiss = () => {
    restoreRef.current();
    callbacks.current.onClose();
  };
  const change = (patch: Partial<ReaderAppearanceValues>) => {
    setError(false);
    keepReadingAnchor(() =>
      useReaderSettings.getState().previewAppearance(patch)
    );
  };
  const save = () => {
    if (
      !useReaderSettings
        .getState()
        .saveAppearance(
          { ...appearanceValues(), fontStep, fontStepExplicit: true },
          theme
        )
    ) {
      setError(true);
      return;
    }
    snapshot.current = null;
    if (previewingVoice.current) cancelSpeech();
    previewingVoice.current = false;
    callbacks.current.onClose();
  };

  return (
    <dialog
      ref={ref}
      aria-labelledby={title}
      className="reader-appearance rdc-appearance"
      onCancel={(e) => {
        e.preventDefault();
        dismiss();
      }}
      onClick={(e) => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          dismiss();
      }}
    >
      <header className="rdc-dialog-header">
        <div>
          <p className="rdc-eyebrow">
            {ru ? 'Читать с комфортом' : 'Make yourself comfortable'}
          </p>
          <h2 ref={headingRef} tabIndex={-1} id={title}>
            {ru ? 'Вид текста' : 'Text appearance'}
          </h2>
        </div>
        <button
          type="button"
          className="rdc-icon-button"
          aria-label={ru ? 'Закрыть' : 'Close'}
          onClick={dismiss}
        >
          <ReaderIcon name="close" />
        </button>
      </header>
      <div className="rdc-dialog-body">
        <p className="rdc-hint">
          {ru
            ? 'Изменения видны сразу. Сохраните их или отмените, чтобы вернуть прежний вид.'
            : 'Changes preview immediately. Save them or cancel to restore your previous appearance.'}
        </p>
        <fieldset className="rdc-preference-group">
          <legend>{ru ? 'Текст книги' : 'Book text'}</legend>
          <ReaderTextSize
            step={fontStep}
            defaultStep={DEFAULT_BOOK_FONT_STEP}
            display="pixels"
            onChange={(step) =>
              change({ fontStep: step, fontStepExplicit: true })
            }
          />
          <div className="rdc-fields">
            <label htmlFor={fontId}>
              {ru ? 'Шрифт' : 'Font'}
              <select
                id={fontId}
                value={fontFamily ?? defaultFontFamily}
                onChange={(e) =>
                  change({
                    fontFamily: e.target.value === 'serif' ? 'serif' : 'sans',
                  })
                }
              >
                <option value="serif">{ru ? 'С засечками' : 'Serif'}</option>
                <option value="sans">
                  {ru ? 'Без засечек' : 'Sans serif'}
                </option>
              </select>
            </label>
            <label htmlFor={lineId}>
              {ru ? 'Межстрочный интервал' : 'Line spacing'}
              <select
                id={lineId}
                value={lineStep}
                onChange={(e) => change({ lineStep: Number(e.target.value) })}
              >
                <option value={0}>{ru ? 'Обычный' : 'Normal'}</option>
                <option value={1}>{ru ? 'Свободный' : 'Spacious'}</option>
              </select>
            </label>
          </div>
          <label className="rdc-checkbox">
            <input
              type="checkbox"
              checked={coloring}
              onChange={(e) => change({ coloring: e.target.checked })}
            />
            <span>
              {ru
                ? 'Подсвечивать новые и изучаемые слова'
                : 'Highlight new words and words I am learning'}
            </span>
          </label>
        </fieldset>
        <fieldset className="rdc-preference-group">
          <legend>{ru ? 'Тема' : 'Theme'}</legend>
          <div className="rdc-themes">
            {THEMES.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={theme === item.id}
                className={`rdc-theme rdc-theme-${item.id}`}
                onClick={() => {
                  setError(false);
                  keepReadingAnchor(() => useTheme.getState().preview(item.id));
                }}
              >
                <span className="rdc-theme-swatch" aria-hidden="true">
                  Aa
                </span>
                <span>{ru ? item.ru : item.en}</span>
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="rdc-preference-group">
          <legend>{ru ? 'Голос' : 'Voice'}</legend>
          <label htmlFor={voiceId}>
            {ru ? 'Английская озвучка' : 'English read-aloud'}
          </label>
          <div className="rdc-voice-row">
            <select
              id={voiceId}
              value={voiceURI ?? ''}
              disabled={!available}
              onChange={(e) => change({ voiceURI: e.target.value || null })}
            >
              <option value="">
                {ru ? 'Автоматический выбор' : 'Automatic selection'}
              </option>
              {voiceURI && !voices.some((v) => v.voiceURI === voiceURI) && (
                <option value={voiceURI}>
                  {ru
                    ? 'Сохранённый голос недоступен'
                    : 'Saved voice unavailable'}
                </option>
              )}
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} · {v.lang}
                  {!v.localService ? (ru ? ' · сеть' : ' · network') : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rdc-button"
              disabled={
                !available ||
                (!!voiceURI && !voices.some((v) => v.voiceURI === voiceURI))
              }
              onClick={() => {
                callbacks.current.onBeforeVoicePreview?.();
                previewingVoice.current = true;
                setVoicePreviewActive(true);
                previewVoice(voiceURI, VOICE_SAMPLE);
              }}
            >
              <ReaderIcon name="volume" />
              {ru ? 'Послушать' : 'Preview'}
            </button>
            <button
              type="button"
              className="rdc-icon-button"
              disabled={!available || !voicePreviewActive}
              aria-label={
                ru ? 'Остановить пример голоса' : 'Stop voice preview'
              }
              onClick={() => {
                cancelSpeech();
                previewingVoice.current = false;
                setVoicePreviewActive(false);
              }}
            >
              <ReaderIcon name="stop" />
            </button>
          </div>
          <p className="rdc-hint">
            {!available
              ? ru
                ? 'Озвучка недоступна на этом устройстве.'
                : 'Read-aloud is unavailable on this device.'
              : ru
                ? 'Показаны голоса устройства. Для сетевых голосов требуется подключение.'
                : 'These are the voices available on your device. Network voices need a connection.'}
          </p>
        </fieldset>
        {error && (
          <p role="alert" className="rdc-error">
            {ru
              ? 'Не удалось сохранить настройки в браузере. Повторите сохранение; отмена вернёт оформление на экране.'
              : 'The browser could not save these preferences. Retry saving; Cancel restores the appearance on screen.'}
          </p>
        )}
        <div className="rdc-dialog-actions">
          <button
            type="button"
            className="rdc-button rdc-primary"
            onClick={save}
          >
            {ru ? 'Сохранить' : 'Save'}
          </button>
          <button type="button" className="rdc-button" onClick={dismiss}>
            {ru ? 'Отменить' : 'Cancel'}
          </button>
          <button
            type="button"
            className="rdc-text-button"
            onClick={() =>
              change({
                fontStep: DEFAULT_BOOK_FONT_STEP,
                fontStepExplicit: true,
                fontFamily: defaultFontFamily,
                lineStep: 0,
                coloring: true,
                voiceURI: null,
              })
            }
          >
            {ru ? 'По умолчанию' : 'Reset appearance'}
          </button>
        </div>
      </div>
    </dialog>
  );
}
