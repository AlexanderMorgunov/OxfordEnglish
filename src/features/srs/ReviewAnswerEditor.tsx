import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { SrsCard } from '@/db/db';
import { Button, Input } from '@/shared/ui';
import { Dialog } from '@/shared/ui/Dialog';
import { useUiLang } from '@/features/i18n/uiLang';
import { captureDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import {
  useAiEnabled,
  useAiUnknown,
  AI_REQUEST_TIMEOUT,
} from '@/features/ai/route';
import { aiTranslate } from '@/features/ai/functions';
import { editCardAnswer } from '@/features/vocab/manage';
import { dictionaryAnswer, sameCardContent } from './answer';

export function ReviewAnswerEditor({
  source,
  latest,
  onClose,
}: {
  source: SrsCard;
  latest: SrsCard;
  onClose: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    config = useAiStore((s) => s.config);
  const enabled = useAiEnabled(),
    unknown = useAiUnknown();
  const [translation, setTranslation] = useState(
      dictionaryAnswer(source) ?? ''
    ),
    [gloss, setGloss] = useState(source.contextGloss ?? '');
  const [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [aiBusy, setAiBusy] = useState(false);
  const [proposal, setProposal] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null),
    alive = useRef(false),
    lock = useRef(false);
  const [owned] = useState(captureDataScope);
  const currentCard = useRef(latest);
  currentCard.current = latest;
  const generation = useRef(0),
    input = useRef<HTMLInputElement>(null),
    aiButton = useRef<HTMLButtonElement>(null),
    cancelButton = useRef<HTMLButtonElement>(null),
    focusAfter = useRef(false);
  useEffect(() => {
    if (aiBusy && document.activeElement === aiButton.current) cancelButton.current?.focus();
    if (!aiBusy && focusAfter.current) { focusAfter.current = false; aiButton.current?.focus(); }
  }, [aiBusy]);
  const cancelRequest = () => {
    generation.current++;
    request.current?.abort();
    request.current = null;
    setAiBusy(false);
  };
  useEffect(() => {
    alive.current = true;
    const frame = requestAnimationFrame(() => input.current?.focus());
    return () => {
      alive.current = false;
      generation.current = generation.current + 1;
      request.current?.abort();
      cancelAnimationFrame(frame);
    };
  }, []);
  useEffect(() => {
    request.current?.abort();
    request.current = null;
    generation.current++;
    setAiBusy(false);
    setProposal(null);
  }, [config, enabled, unknown]);
  const active = () => alive.current && owned();
  const changed = () =>
    !sameCardContent(source, currentCard.current) ||
    source.creationId !== currentCard.current.creationId || source.createdAt !== currentCard.current.createdAt;
  const suggest = async () => {
    if (
      request.current ||
      !enabled ||
      unknown ||
      saving ||
      !source.contextSentence ||
      !active()
    )
      return;
    const controller = new AbortController(),
      revision = ++generation.current;
    request.current = controller;
    setAiBusy(true);
    setProposal(null);
    setError('');
    const valid = () =>
      active() && revision === generation.current && !controller.signal.aborted;
    const timer = setTimeout(() => {
      if (!valid()) return;
      focusAfter.current = document.activeElement === cancelButton.current;
      controller.abort();
      request.current = null;
      setAiBusy(false);
      setError(
        ru
          ? 'Запрос занял слишком долго. Повторите или исправьте ответ вручную.'
          : 'The request timed out. Retry or edit manually.'
      );
    }, AI_REQUEST_TIMEOUT + 2000);
    try {
      const text = await aiTranslate(config, source.front, {
        sentence: source.contextSentence,
        signal: controller.signal,
      });
      if (!valid()) return;
      if (changed())
        setError(
          ru
            ? 'Карточка изменилась. Отмените правку и откройте её заново.'
            : 'The card changed. Cancel and reopen the editor.'
        );
      else setProposal(text);
    } catch {
      if (valid())
        setError(
          ru
            ? 'Контекстный перевод недоступен. Можно исправить ответ вручную.'
            : 'Context translation unavailable. You can edit the answer manually.'
        );
    } finally {
      clearTimeout(timer);
      if (valid()) {
        focusAfter.current = document.activeElement === cancelButton.current;
        request.current = null;
        setAiBusy(false);
      }
    }
  };
  const close = () => {
    cancelRequest();
    onClose();
  };
  const save = async () => {
    if (lock.current || !active()) return;
    if (changed()) {
      setError(
        ru
          ? 'Карточка изменилась. Отмените правку и откройте её заново.'
          : 'The card changed. Cancel and reopen the editor.'
      );
      return;
    }
    lock.current = true;
    cancelRequest();
    setSaving(true);
    setError('');
    try {
      const saved = await editCardAnswer(source, translation, gloss, () =>
        active()
      );
      if (!active()) return;
      if (saved) onClose();
      else
        setError(
          ru
            ? 'Карточка изменилась. Отмените правку и откройте её заново.'
            : 'The card changed. Cancel and reopen the editor.'
        );
    } catch {
      if (active())
        setError(
          ru
            ? 'Не удалось сохранить. Попробуйте ещё раз.'
            : 'Could not save. Please try again.'
        );
    } finally {
      lock.current = false;
      if (active()) setSaving(false);
    }
  };
  return (
    <Dialog title={ru ? 'Исправить ответ' : 'Edit answer'} onClose={close}>
      <form
        className="rv-editor"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p lang="en" className="rv-editor-term">
          {source.front}
        </p>
        {source.contextSentence && (
          <p lang="en" className="rv-help">
            {source.contextSentence}
          </p>
        )}
        <label>
          {ru ? 'Общий перевод' : 'General translation'}
          <Input
            ref={input}
            value={translation}
            disabled={saving}
            maxLength={3000}
            onChange={(event) => {
              cancelRequest();
              setProposal(null);
              setTranslation(event.target.value);
            }}
          />
        </label>
        <label>
          {ru ? 'Значение в контексте' : 'Meaning in context'}
          <Input
            value={gloss}
            disabled={saving}
            maxLength={3000}
            onChange={(event) => {
              cancelRequest();
              setProposal(null);
              setGloss(event.target.value);
            }}
          />
        </label>
        <p className="rv-help">
          {ru
            ? 'Общий перевод — для слова в целом. Значение в контексте — для этого примера; оно будет ответом на карточке.'
            : 'The general translation describes the term. The contextual meaning answers this card in its example.'}
        </p>
        {source.contextSentence && (
          <div className="rv-editor-assist">
            <Button
              ref={aiButton}
              variant="ghost"
              disabled={saving || aiBusy || !enabled || unknown}
              onClick={() => void suggest()}
            >
              {ru ? 'Уточнить в контексте · AI' : 'Translate in context · AI'}
            </Button>
            {aiBusy && (
              <Button
                ref={cancelButton}
                variant="ghost"
                onClick={() => {
                  cancelRequest();
                  aiButton.current?.focus();
                }}
              >
                {ru ? 'Отменить запрос' : 'Cancel AI request'}
              </Button>
            )}
            {!enabled && !unknown && (
              <p className="rv-help">
                {ru ? 'AI доступен в ' : 'AI requires '}
                <Link to="/pro">DayEnglish Pro</Link>
                {ru
                  ? ' или со своим ключом. Ручной ввод доступен всегда.'
                  : ' or your own key. Manual editing is always available.'}
              </p>
            )}
            {unknown && (
              <p role="status" className="rv-help">
                {ru ? 'Проверяем доступ к AI…' : 'Checking AI access…'}
              </p>
            )}
            {aiBusy && (
              <p role="status" className="rv-help">
                {ru ? 'Уточняем значение…' : 'Getting meaning…'}
              </p>
            )}
            {proposal && (
              <div className="rv-proposal">
                <p className="rv-help">
                  {ru
                    ? 'Предложение AI — проверьте перед сохранением'
                    : 'AI suggestion — check before saving'}
                </p>
                <p>{proposal}</p>
                <div className="rv-actions">
                  <Button
                    variant="ghost"
                    onClick={() => {
                      if (changed() || !active()) {
                        setError(
                          ru
                            ? 'Карточка изменилась. Откройте редактор заново.'
                            : 'The card changed. Reopen the editor.'
                        );
                        return;
                      }
                      setGloss(proposal);
                      setProposal(null);
                    }}
                  >
                    {ru ? 'Подставить в поле' : 'Use this meaning'}
                  </Button>
                  <Button variant="ghost" onClick={() => setProposal(null)}>
                    {ru ? 'Отклонить' : 'Dismiss'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="rv-error">
            {error}
          </p>
        )}
        <div className="rv-actions">
          <Button type="submit" disabled={saving || aiBusy}>
            {saving
              ? ru
                ? 'Сохраняем…'
                : 'Saving…'
              : ru
                ? 'Сохранить'
                : 'Save'}
          </Button>
          <Button variant="ghost" onClick={close}>
            {ru ? 'Отмена' : 'Cancel'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
