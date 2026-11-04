import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { captureDataScope } from '@/features/account/dataScope';
import {
  AI_REQUEST_TIMEOUT,
  useAiEnabled,
  useAiUnknown,
} from '@/features/ai/route';
import { useAiStore } from '@/features/ai/store';
import { SenseTermSchema, SENSES_COST } from '@/features/ai/word-senses';
import type { WordSense } from '@/features/ai/word-senses';
import { requestWordSenses } from './word-senses';

export function VocabularyExample({
  term,
  revision,
  disabled,
  onApply,
  onBusyChange,
}: {
  term: string;
  revision: number;
  disabled: boolean;
  onApply: (sense: WordSense) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    config = useAiStore((s) => s.config);
  const enabled = useAiEnabled(),
    unknown = useAiUnknown();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const [senses, setSenses] = useState<WordSense[]>([]);
  const request = useRef<AbortController | null>(null),
    button = useRef<HTMLButtonElement>(null),
    cancelButton = useRef<HTMLButtonElement>(null);
  const latest = useRef({ term, revision, disabled, enabled });
  latest.current = { term, revision, disabled, enabled };
  const alive = useRef(false);
  const proposalOwner = useRef<{
    term: string;
    revision: number;
    current: () => boolean;
  } | null>(null);
  const focusAfter = useRef(false),
    firstChoice = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (
      busy &&
      (document.activeElement === button.current ||
        document.activeElement === document.body)
    )
      cancelButton.current?.focus();
    else if (!busy && focusAfter.current) {
      focusAfter.current = false;
      (firstChoice.current ?? button.current)?.focus();
    }
  }, [busy, senses]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      request.current?.abort();
    };
  }, []);
  useEffect(() => {
    request.current?.abort();
    proposalOwner.current = null;
    request.current = null;
    setBusy(false);
    setSenses([]);
    setError('');
  }, [term, revision, disabled, enabled, config]);
  useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  const lookup = async () => {
    if (
      request.current ||
      disabled ||
      !enabled ||
      unknown ||
      !SenseTermSchema.safeParse(term).success
    )
      return;
    const owned = captureDataScope(),
      controller = new AbortController();
    request.current = controller;
    const current = () =>
      alive.current &&
      owned() &&
      request.current === controller &&
      !controller.signal.aborted &&
      latest.current.revision === revision &&
      latest.current.term === term &&
      !latest.current.disabled &&
      latest.current.enabled;
    setBusy(true);
    setSenses([]);
    setError('');
    const timer = setTimeout(() => {
      if (!current()) return;
      const focus = document.activeElement === cancelButton.current;
      focusAfter.current = focus;
      controller.abort();
      request.current = null;
      setBusy(false);
      setError(
        ru
          ? 'Запрос занял слишком долго. Повторите или напишите пример вручную.'
          : 'The request timed out. Retry or write an example yourself.'
      );
      if (focus) button.current?.focus();
    }, AI_REQUEST_TIMEOUT + 2000);
    try {
      const result = await requestWordSenses(term, config, controller.signal);
      if (!current()) return;
      focusAfter.current = document.activeElement === cancelButton.current;
      proposalOwner.current = { term, revision, current: owned };
      setSenses(result.senses);
      if (!result.senses.length)
        setError(
          ru
            ? 'Подходящий пример не найден. Можно написать свой.'
            : 'No reliable example found. You can write your own.'
        );
    } catch {
      if (current())
        focusAfter.current = document.activeElement === cancelButton.current;
      if (current())
        setError(
          ru
            ? 'Не удалось получить пример. Повторите запрос или напишите его вручную.'
            : 'Could not get an example. Retry or write one yourself.'
        );
    } finally {
      clearTimeout(timer);
      if (current()) {
        request.current = null;
        setBusy(false);
      }
    }
  };
  return (
    <div className="vc-example-assist">
      <div className="vc-actions">
        <Button
          ref={button}
          variant="ghost"
          disabled={
            disabled ||
            busy ||
            !enabled ||
            unknown ||
            !SenseTermSchema.safeParse(term).success
          }
          onClick={() => void lookup()}
        >
          {ru ? 'Составить пример · AI' : 'Create example · AI'}
        </Button>
        {busy && (
          <Button
            ref={cancelButton}
            variant="ghost"
            onClick={() => {
              request.current?.abort();
              focusAfter.current = true;
              request.current = null;
              setBusy(false);
              button.current?.focus();
            }}
          >
            {ru ? 'Отменить запрос' : 'Cancel example request'}
          </Button>
        )}
      </div>
      <p className="vc-help">
        {enabled && !unknown ? (
          ru ? (
            `Выберите пример с нужным значением. Новый запрос: ${SENSES_COST} единицы AI-квоты; свой ключ — по тарифу провайдера.`
          ) : (
            `Choose an example with the right meaning. A new request uses ${SENSES_COST} AI quota units; your key uses provider billing.`
          )
        ) : unknown ? (
          ru ? (
            'Проверяем доступ к AI… Ручной ввод доступен.'
          ) : (
            'Checking AI access… You can still type manually.'
          )
        ) : (
          <>
            {ru ? 'Примеры AI доступны в ' : 'AI examples require '}
            <Link to="/pro">DayEnglish Pro</Link>
            {ru
              ? ' или со своим ключом. Ручной ввод доступен всегда.'
              : ' or your own key. You can always type manually.'}
          </>
        )}
      </p>
      {busy && (
        <p role="status">{ru ? 'Подбираем примеры…' : 'Finding examples…'}</p>
      )}
      {error && (
        <p role="alert" className="vc-error">
          {error}
        </p>
      )}
      {!!senses.length && (
        <ul
          className="vc-example-proposals"
          aria-label={ru ? 'Примеры по значениям' : 'Examples by meaning'}
        >
          {senses.map((sense, index) => (
            <li key={index}>
              <p>
                <strong>{sense.translation}</strong> · {sense.distinction}
              </p>
              <p lang="en">{sense.example}</p>
              <Button
                variant="ghost"
                disabled={disabled}
                ref={index === 0 ? firstChoice : undefined}
                onClick={() => {
                  const owner = proposalOwner.current;
                  if (
                    !owner?.current() ||
                    owner.term !== latest.current.term ||
                    owner.revision !== latest.current.revision ||
                    latest.current.disabled ||
                    !latest.current.enabled
                  )
                    return;
                  onApply(sense);
                  setSenses([]);
                }}
              >
                {ru
                  ? `Использовать пример ${index + 1}`
                  : `Use example ${index + 1}`}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
