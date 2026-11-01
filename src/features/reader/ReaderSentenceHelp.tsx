import { useEffect, useRef, useState } from 'react';
import type { Level } from '@/content/schema';
import {
  captureAiScope,
  useAiEnabled,
  useAiUnknown,
} from '@/features/ai/route';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { captureDataScope } from '@/features/account/dataScope';
import { clampBand } from '@/features/ai/simplify-prompts';
import { useUiLang } from '@/features/i18n/uiLang';
import { track } from '@/features/analytics/analytics';
import { ReaderIcon } from './ReaderIcon';
import { useReaderSettings } from './settings';
import type { LensMode } from './lens';
import type { ReaderTranslation } from './translate';
import { estimateCoverage, rankThresholdFor } from './difficulty';
import type { FreqIndex } from './difficulty';

type Props = {
  sentence: string;
  level: Level | null;
  freq: FreqIndex | null;
  canSpeak: boolean;
  playing: boolean;
  onSpeak: () => void;
  bookmarked: boolean;
  onBookmark?: () => void;
  onLens: (
    mode: LensMode,
    text: string,
    stepDown?: number,
    signal?: AbortSignal,
    onSource?: (source: ReaderTranslation['source']) => void
  ) => Promise<string | null>;
};
const noKnown = new Set<string>();

export function ReaderSentenceHelp({
  sentence,
  level,
  freq,
  canSpeak,
  playing,
  onSpeak,
  bookmarked,
  onBookmark,
  onLens,
}: Props) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const aiReady = useAiEnabled();
  const aiUnknown = useAiUnknown();
  const aiTranslation = useReaderSettings((s) => s.aiTranslation);
  const toggleAiTranslation = useReaderSettings((s) => s.toggleAiTranslation);
  const [mode, setMode] = useState<LensMode>('translate');
  const [result, setResult] = useState<{
    text: string;
    source: ReaderTranslation['source'];
    echo: boolean;
    step: number;
  } | null>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>(
    'idle'
  );
  const pending = useRef<AbortController | null>(null);
  useEffect(() => () => pending.current?.abort(), []);
  const run = async (nextMode: LensMode, step = 0) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    const current = captureDataScope();
    const requireActive = captureAiScope(controller.signal);
    setMode(nextMode);
    setState('loading');
    setResult(null);
    if (nextMode === 'simplify')
      void track('simplify_used', { band: clampBand(level, step), step });
    if (nextMode === 'grammar')
      void track('grammar_used', { band: clampBand(level, 0) });
    try {
      let source: ReaderTranslation['source'];
      const text = await onLens(
        nextMode,
        sentence,
        step,
        controller.signal,
        (value) => {
          source = value;
        }
      );
      requireActive();
      if (!current() || pending.current !== controller) return;
      const echo = nextMode === 'simplify' && text?.trim() === sentence.trim();
      const atBand =
        echo &&
        freq &&
        estimateCoverage(sentence, {
          freq,
          known: noKnown,
          rankThreshold: rankThresholdFor(clampBand(level, step)),
        }).coverage >= 0.9;
      if (!text || (echo && !atBand)) setState('error');
      else {
        setResult({ text, source, echo, step });
        setState('done');
      }
    } catch {
      if (
        current() &&
        !controller.signal.aborted &&
        pending.current === controller
      )
        setState('error');
    }
  };
  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setState('idle');
  };
  const sourceLabel =
    result?.source === 'free'
      ? ru
        ? 'Бесплатный перевод'
        : 'Free translation'
      : result?.source === 'managed'
        ? ru
          ? 'AI · подписка'
          : 'AI · subscription'
        : result?.source === 'byok'
          ? ru
            ? 'AI · свой ключ'
            : 'AI · your key'
          : null;
  return (
    <>
      <h2>{ru ? 'Разобрать предложение' : 'Sentence help'}</h2>
      <blockquote className="rdh-quote" lang="en">
        {sentence}
      </blockquote>
      <p className="rdh-note">
        {ru ? 'Исходное предложение' : 'Original sentence'}
      </p>
      {!aiReady && !aiUnknown && (
        <p className="rdh-note">
          <AiUpsellLink />
        </p>
      )}
      <div className="rdh-actions">
        {canSpeak && (
          <button
            type="button"
            className="rdh-action"
            aria-pressed={playing}
            onClick={onSpeak}
          >
            <ReaderIcon name="volume" />
            {playing ? (ru ? 'Остановить' : 'Stop') : ru ? 'Слушать' : 'Listen'}
          </button>
        )}
        {onBookmark && (
          <button
            type="button"
            className="rdh-action"
            aria-pressed={bookmarked}
            onClick={onBookmark}
          >
            <ReaderIcon name="bookmark" />
            {bookmarked
              ? ru
                ? 'Убрать закладку'
                : 'Remove bookmark'
              : ru
                ? 'Заложить'
                : 'Bookmark'}
          </button>
        )}
      </div>
      <div
        className="rdh-actions"
        role="group"
        aria-label={ru ? 'Помощь с предложением' : 'Sentence tools'}
      >
        {(['translate', 'simplify', 'grammar'] as const).map((value) => (
          <button
            type="button"
            key={value}
            className="rdh-action"
            aria-pressed={mode === value && state !== 'idle'}
            onClick={() => void run(value)}
          >
            {value === 'translate'
              ? ru
                ? 'Перевод'
                : 'Translate'
              : value === 'simplify'
                ? ru
                  ? 'Проще'
                  : 'Simplify'
                : ru
                  ? 'Грамматика'
                  : 'Grammar'}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="rdh-note hover:underline"
        onClick={toggleAiTranslation}
      >
        {ru ? 'Перевод' : 'Translation'}:{' '}
        {aiTranslation ? 'AI' : ru ? 'бесплатный' : 'free'}
      </button>
      <div className="rdh-result">
        {state === 'idle' && (
          <p className="rdh-note">
            {ru
              ? 'Выберите, какая помощь нужна. Оригинал остаётся перед вами.'
              : 'Choose the help you need. The original stays available.'}
          </p>
        )}
        {state === 'loading' && (
          <>
            <p role="status">{ru ? 'Готовлю ответ…' : 'Preparing answer…'}</p>
            <button
              type="button"
              className="rdh-note hover:underline"
              onClick={cancel}
            >
              {ru ? 'Отменить запрос' : 'Cancel request'}
            </button>
          </>
        )}
        {state === 'error' && (
          <>
            <p role="alert">
              {ru
                ? 'Ответ недоступен. Проверьте сеть и доступ к AI или попробуйте бесплатный перевод.'
                : 'Answer unavailable. Check the connection and AI access, or try free translation.'}
            </p>
            <button
              type="button"
              className="rdh-action"
              onClick={() => void run(mode)}
            >
              {ru ? 'Повторить запрос' : 'Retry request'}
            </button>
          </>
        )}
        {state === 'done' && result && (
          <>
            <p role="status" lang={mode === 'simplify' ? 'en' : 'ru'}>
              {result.echo
                ? ru
                  ? 'Уже достаточно простое для выбранного уровня.'
                  : 'Already simple enough for this level.'
                : result.text}
            </p>
            {sourceLabel && <p className="rdh-note">{sourceLabel}</p>}
            {mode === 'simplify' &&
              !result.echo &&
              clampBand(level, result.step) !== 'A1' && (
                <button
                  type="button"
                  className="rdh-action"
                  onClick={() => void run('simplify', result.step + 1)}
                >
                  {ru ? 'Ещё проще' : 'Even simpler'} ·{' '}
                  {clampBand(level, result.step + 1)}
                </button>
              )}
          </>
        )}
      </div>
      <p className="rdh-note">
        {ru
          ? 'Упрощение и грамматика: Trial/Pro, свой ключ или ранее сохранённый кеш.'
          : 'Simplification and grammar: Trial/Pro, your key or previously cached answers.'}
      </p>
    </>
  );
}
