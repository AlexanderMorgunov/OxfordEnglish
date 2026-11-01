import {
  use,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useStore } from 'zustand';
import type { Exercise } from '@/content/schema';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { useLearner } from '@/features/learner/store';
import { ExerciseView } from '@/features/practice/exercises/ExerciseView';
import { ExerciseSessionContext } from '@/features/practice/exercises/session';
import { useAiStore } from '@/features/ai/store';
import {
  captureAiScope,
  useAiEnabled,
  useAiUnknown,
  aiAvailable,
} from '@/features/ai/route';
import { AiUpsellLink } from '@/features/ai/AiUpsellLink';
import { generateReaderExercises } from '@/features/ai/functions';
import { useAccount } from '@/features/account/store';
import {
  getDataOwnerRevision,
  getDataScopeRevision,
  subscribeDataScope,
} from '@/features/account/dataScope';
import { estimateCoverage, loadFreq, rankThresholdFor } from './difficulty';
import type { FreqIndex } from './difficulty';
import { generateExercises } from './exercises';
import { ReaderIcon } from './ReaderIcon';
import './reader-chapter.css';

function identifyExercise(exercise: Exercise): Exercise {
  const { id, ...content } = exercise;
  let fingerprint = 14695981039346656037n;
  for (const character of JSON.stringify(content)) {
    fingerprint = BigInt.asUintN(
      64,
      (fingerprint ^ BigInt(character.codePointAt(0)!)) * 1099511628211n
    );
  }
  // Index-based generator IDs must not restore answers for a newly generated question.
  return { ...exercise, id: `${id}.${fingerprint.toString(36)}` };
}

export function ChapterStudy({
  text,
  idPrefix,
  embedded = false,
}: {
  text: string;
  idPrefix: string;
  embedded?: boolean;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const level = useLearner((s) => s.level);
  const statuses = useVocabStore((s) => s.statuses);
  const loadVocab = useVocabStore((s) => s.load);
  const aiConfig = useAiStore((s) => s.config);
  const sessionRevision = useAccount((s) => s.sessionRevision);
  const dataRevision = useSyncExternalStore(
    subscribeDataScope,
    getDataScopeRevision
  );
  const aiReady = useAiEnabled();
  const aiUnknown = useAiUnknown();
  const [freq, setFreq] = useState<FreqIndex | null>(null);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [source, setSource] = useState<'local' | 'ai'>('local');
  const [step, setStep] = useState(0);
  const [solved, setSolved] = useState(false);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'error'>('idle');
  const pending = useRef<AbortController | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const results = use(ExerciseSessionContext);
  const exercise = exercises?.[step];
  const previouslySolved = useStore(
    results,
    (s) =>
      s.scopeRevision === getDataOwnerRevision() &&
      !!exercise &&
      !!s.results[exercise.id]?.solved
  );

  useEffect(() => {
    let alive = true;
    void loadVocab();
    void loadFreq()
      .then((loaded) => {
        if (alive) setFreq(loaded);
      })
      .catch(() => {
        if (alive) setFreq(new Map());
      });
    return () => {
      alive = false;
    };
  }, [loadVocab]);

  const built = useMemo(() => {
    const set = new Set<string>();
    for (const [word, status] of statuses)
      if (status === 'known') set.add(word);
    return set;
  }, [statuses]);
  const knownRef = useRef(built);
  if (!(
    knownRef.current.size === built.size &&
    [...built].every((w) => knownRef.current.has(w))
  ))
    knownRef.current = built;
  const known = knownRef.current;
  const rankThreshold = rankThresholdFor(level);
  const coverage = useMemo(
    () =>
      freq?.size
        ? estimateCoverage(text, { freq, known, rankThreshold })
        : null,
    [freq, text, known, rankThreshold]
  );

  useEffect(() => {
    setExercises(null);
    setStep(0);
    setSolved(false);
    setAiState('idle');
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [text, idPrefix, aiConfig, sessionRevision, dataRevision]);
  useEffect(() => {
    if (exercises?.length) heading.current?.focus({ preventScroll: true });
  }, [exercises, step]);

  const cancel = () => {
    pending.current?.abort();
    pending.current = null;
    setAiState('idle');
  };
  const showMenu = () => {
    cancel();
    setExercises(null);
    setStep(0);
    setSolved(false);
    requestAnimationFrame(() =>
      menuButton.current?.focus({ preventScroll: true })
    );
  };
  const start = (made: Exercise[], from: 'local' | 'ai') => {
    setSource(from);
    setStep(0);
    setSolved(false);
    setExercises(made.map(identifyExercise));
  };
  const generate = () => {
    if (!freq?.size) return;
    cancel();
    start(
      generateExercises(text, {
        freq,
        known,
        rankThreshold,
        idPrefix: `${idPrefix}.local`,
        count: 8,
      }),
      'local'
    );
  };
  const generateAi = async () => {
    if (!aiAvailable(aiConfig) || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    const requireActive = captureAiScope(controller.signal);
    setAiState('loading');
    try {
      const made = await generateReaderExercises(aiConfig, {
        text,
        targets: [...(coverage?.unknown.keys() ?? [])],
        idPrefix: `${idPrefix}.ai`,
        signal: controller.signal,
      });
      requireActive();
      if (made.length) start(made, 'ai');
      setAiState(made.length ? 'idle' : 'error');
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      )
        return;
      setAiState('error');
    } finally {
      if (pending.current === controller) {
        pending.current = null;
        setAiState((state) => (state === 'loading' ? 'idle' : state));
      }
    }
  };
  const pct = coverage ? Math.round(coverage.coverage * 100) : null;
  const reliable = !!coverage && coverage.total >= 20;
  const complete =
    exercises !== null && exercises.length > 0 && step >= exercises.length;

  return (
    <section
      className={`rds-chapter-study${embedded ? '' : ' rds-chapter-study-standalone'}`}
      aria-label={ru ? 'Упражнения по главе' : 'Chapter exercises'}
    >
      {exercises === null ? (
        <>
          <div className="rds-difficulty-note">
            {freq === null ? (
              <p role="status">
                {ru
                  ? 'Оцениваю словарь главы…'
                  : 'Estimating chapter vocabulary…'}
              </p>
            ) : !freq.size ? (
              <p>
                {ru
                  ? 'Частотный словарь недоступен. Обычные упражнения и оценка сложности пока недоступны.'
                  : 'The frequency list is unavailable. Local exercises and difficulty estimates are unavailable for now.'}
              </p>
            ) : reliable ? (
              <p>
                {ru ? 'Ориентировочно знакомо ' : 'Estimated familiar words: '}
                <strong>{pct}%</strong>
                {ru ? ' слов главы.' : ' of this chapter.'}
              </p>
            ) : (
              <p>
                {ru
                  ? 'В главе слишком мало текста для надёжной оценки сложности.'
                  : 'This chapter is too short for a reliable difficulty estimate.'}
              </p>
            )}
            <small>
              {ru
                ? 'Ориентир по частотному словарю, вашему уровню и отметкам «Знаю». Это не проверка понимания текста.'
                : 'Based on word frequency, your level and words marked known. This does not measure text comprehension.'}
              {!level &&
                (ru
                  ? ' Тест уровня уточнит оценку.'
                  : ' A placement test can refine the estimate.')}
            </small>
          </div>
          <h3 className="rds-practice-title">
            {ru
              ? 'Немного практики по этой истории'
              : 'A little practice from this chapter'}
          </h3>
          <p className="rds-practice-note">
            {ru
              ? 'Закрепите слова и конструкции из прочитанного. Начните с упражнений из текста или запросите задания у AI.'
              : 'Practise words and structures from your reading. Start with exercises from the text or ask AI for a set.'}
          </p>
          {aiState === 'error' && (
            <p role="alert" className="rds-chapter-error">
              {ru
                ? 'AI не ответил. Попробуйте ещё раз или выберите упражнения из главы.'
                : 'AI did not answer. Try again or choose exercises from the chapter.'}
            </p>
          )}
          <div className="rds-practice-actions">
            <Button ref={menuButton} onClick={generate} disabled={!freq?.size}>
              {ru ? 'Упражнения из этой главы' : 'Exercises from this chapter'}
            </Button>
            {(aiReady || aiUnknown) && (
              <Button
                variant="ghost"
                disabled={aiState === 'loading'}
                onClick={() => void generateAi()}
              >
                <ReaderIcon name="sparkles" />
                {aiState === 'loading'
                  ? ru
                    ? 'AI думает…'
                    : 'AI thinking…'
                  : ru
                    ? 'AI-упражнения'
                    : 'AI exercises'}
              </Button>
            )}
            {aiState === 'loading' && (
              <Button variant="ghost" onClick={cancel}>
                {ru ? 'Отменить' : 'Cancel'}
              </Button>
            )}
            {!aiReady && !aiUnknown && <AiUpsellLink />}
          </div>
          {aiState === 'loading' && (
            <p role="status" className="rds-practice-note">
              {ru ? 'Готовим AI-упражнения…' : 'Preparing AI exercises…'}
            </p>
          )}
          <p className="rds-practice-note">
            {ru
              ? 'AI: trial/Pro или свой ключ. Новый ответ требует сети. Расписание повторений не меняется.'
              : 'AI requires trial/Pro or your own key. A new response needs a connection. Your review schedule stays unchanged.'}
          </p>
        </>
      ) : exercises.length === 0 ? (
        <div className="rds-chapter-state">
          <p>
            {ru
              ? 'В этой главе не нашлось подходящих слов и предложений для обычных упражнений.'
              : 'No suitable words and sentences were found for local exercises in this chapter.'}
          </p>
          <Button variant="ghost" onClick={showMenu}>
            {ru ? 'К выбору практики' : 'Choose practice'}
          </Button>
        </div>
      ) : complete ? (
        <div className="rds-matching-done">
          <ReaderIcon name="check" />
          <h3 ref={heading} tabIndex={-1}>
            {ru ? 'Практика завершена' : 'Practice complete'}
          </h3>
          <p>
            {ru ? 'Заданий пройдено:' : 'Exercises completed:'}{' '}
            {exercises.length}.{' '}
            {ru
              ? 'Расписание повторений не менялось.'
              : 'Your review schedule is unchanged.'}
          </p>
          <Button variant="ghost" onClick={showMenu}>
            {ru ? 'Ещё упражнения' : 'More exercises'}
          </Button>
        </div>
      ) : (
        exercise && (
          <>
            <h3 ref={heading} tabIndex={-1} className="rds-practice-count">
              {ru ? 'Задание' : 'Exercise'} {step + 1} {ru ? 'из' : 'of'}{' '}
              {exercises.length} ·{' '}
              {source === 'ai'
                ? 'AI'
                : ru
                  ? 'Из текста главы'
                  : 'From the chapter text'}
            </h3>
            <div className="rds-exercise">
              <ExerciseView
                key={exercise.id}
                exercise={exercise}
                onSolved={() => setSolved(true)}
              />
            </div>
            <div className="rds-practice-actions">
              {(solved || previouslySolved) && (
                <Button
                  onClick={() => {
                    setSolved(false);
                    setStep((value) => value + 1);
                  }}
                >
                  {step === exercises.length - 1
                    ? ru
                      ? 'Завершить'
                      : 'Finish'
                    : ru
                      ? 'Следующее задание'
                      : 'Next exercise'}
                </Button>
              )}
              <Button variant="ghost" onClick={showMenu}>
                {ru ? 'К выбору практики' : 'Choose practice'}
              </Button>
            </div>
          </>
        )
      )}
    </section>
  );
}
