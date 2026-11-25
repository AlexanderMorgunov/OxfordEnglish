import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Dialog } from '@/shared/ui/Dialog';
import { Button } from '@/shared/ui/Button';
import { useUiLang } from '@/features/i18n/uiLang';
import {
  readCapturedPhrase,
  saveCapturedPhrase,
} from '@/features/capture/service';
import { translateReaderResult } from '@/features/reader/translate';
import { aiAvailable } from '@/features/ai/route';
import { useAiStore } from '@/features/ai/store';
import { useEntitlement } from '@/features/account/entitlement';
import type { GameScope } from './storage';
import type { z } from 'zod';
import type { CaptureSchema, TranslationSchema } from './contract';
import { GameCloudDialog } from './GameCloudDialog';

export type GamePrompt = {
  scope: GameScope;
  signal: AbortSignal;
  finish: (result: unknown) => void;
} & (
  | { kind: 'capture'; data: z.infer<typeof CaptureSchema> }
  | { kind: 'translation'; data: z.infer<typeof TranslationSchema> }
  | { kind: 'cloud'; data: { gameId: string; slotId: string } }
);
export function GameActionDialog({ prompt }: { prompt: GamePrompt }) {
  return prompt.kind === 'cloud' ? (
    <GameCloudDialog {...prompt} {...prompt.data} />
  ) : (
    <GameTextActionDialog prompt={prompt} />
  );
}
function GameTextActionDialog({
  prompt,
}: {
  prompt: Exclude<GamePrompt, { kind: 'cloud' }>;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [translation, setTranslation] = useState(
    prompt.kind === 'capture' ? prompt.data.translation : ''
  );
  const [context, setContext] = useState(prompt.data.context);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [source, setSource] = useState('');
  const config = useAiStore((s) => s.config);
  const available = useEntitlement(() => aiAvailable(config));
  const [ai, setAi] = useState(available);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => {
    const next = new AbortController();
    controller.current = next;
    return () => next.abort();
  }, []);
  const close = () => {
    controller.current?.abort();
    prompt.finish(
      prompt.kind === 'capture'
        ? { status: 'cancelled' }
        : { status: 'cancelled', text: null }
    );
  };
  const run = async () => {
    setBusy(true);
    setError('');
    try {
      prompt.scope.check();
      if (!controller.current) return;
      const signal = AbortSignal.any([
        controller.current.signal,
        prompt.signal,
      ]);
      if (signal.aborted) return;
      if (prompt.kind === 'capture') {
        const snapshot = await readCapturedPhrase(prompt.data.term, () => {
          try {
            prompt.scope.check();
            return !signal.aborted;
          } catch {
            return false;
          }
        });
        if (snapshot.state === 'existing') {
          prompt.finish({ status: 'existing' });
          return;
        }
        if (snapshot.state === 'deleted') {
          setError(
            ru
              ? 'Эта карточка удалена. Восстановить её можно в словаре.'
              : 'This card was deleted. Restore it in your vocabulary.'
          );
          return;
        }
        await saveCapturedPhrase(
          { term: prompt.data.term, translation, context, source: null },
          snapshot,
          'save',
          true,
          () => {
            try {
              prompt.scope.check();
              return !signal.aborted;
            } catch {
              return false;
            }
          }
        );
        prompt.scope.check();
        prompt.finish({ status: 'saved' });
      } else {
        const result = await translateReaderResult(prompt.data.text, {
          ai: ai && aiAvailable(useAiStore.getState().config),
          config: useAiStore.getState().config,
          sentence: context,
          signal,
        });
        prompt.scope.check();
        if (signal.aborted) return;
        if (!result) throw new Error('Translation unavailable');
        setTranslation(result.text);
        setSource(
          result.source === 'free'
            ? ru
              ? 'Бесплатный перевод'
              : 'Free translation'
            : ru
              ? 'ИИ-перевод'
              : 'AI translation'
        );
      }
    } catch {
      if (!controller.current?.signal.aborted && !prompt.signal.aborted)
        setError(
          ru
            ? 'Не получилось. Исходный текст сохранён — попробуйте ещё раз.'
            : 'Unavailable. Your text is preserved — please retry.'
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        prompt.kind === 'capture'
          ? ru
            ? 'Добавить к повторению'
            : 'Add to review'
          : ru
            ? 'Перевод из игры'
            : 'Translate from game'
      }
      onClose={close}
      footer={
        <>
          <Button
            onClick={() => void run()}
            disabled={
              busy || (prompt.kind === 'capture' && !translation.trim())
            }
          >
            {busy
              ? ru
                ? 'Подождите…'
                : 'Please wait…'
              : prompt.kind === 'capture'
                ? ru
                  ? 'Сохранить'
                  : 'Save'
                : ru
                  ? 'Перевести'
                  : 'Translate'}
          </Button>
          {prompt.kind === 'translation' && translation && (
            <Button
              variant="ghost"
              onClick={() =>
                prompt.finish({ text: translation, status: 'translated' })
              }
            >
              {ru ? 'Вернуться в игру' : 'Return to game'}
            </Button>
          )}
          <Button variant="ghost" onClick={close}>
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
        </>
      }
    >
      <p className="game-text">
        {prompt.kind === 'capture' ? prompt.data.term : prompt.data.text}
      </p>
      {prompt.kind === 'capture' ? (
        <>
          <label className="game-field">
            {ru ? 'Перевод' : 'Translation'}
            <input
              value={translation}
              maxLength={500}
              onChange={(e) => setTranslation(e.target.value)}
            />
          </label>
          <label className="game-field">
            {ru ? 'Пример' : 'Example'}
            <textarea
              value={context}
              maxLength={1000}
              onChange={(e) => setContext(e.target.value)}
            />
          </label>
        </>
      ) : (
        <>
          <label className="game-field">
            {ru ? 'Способ перевода' : 'Translation method'}
            <select
              value={ai && available ? 'ai' : 'free'}
              onChange={(e) => setAi(e.target.value === 'ai')}
            >
              <option value="free">{ru ? 'Бесплатный' : 'Free'}</option>
              <option value="ai" disabled={!available}>
                {ru ? 'ИИ · Pro / свой ключ' : 'AI · Pro / your key'}
              </option>
            </select>
          </label>
          {!available && (
            <Link to="/pro" onClick={close}>
              DayEnglish Pro
            </Link>
          )}
          {translation && (
            <div role="status">
              <p className="game-text">{translation}</p>
              <small>{source}</small>
            </div>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </Dialog>
  );
}
