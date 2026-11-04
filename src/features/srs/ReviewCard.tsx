import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { Button } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { cancelSpeech, speakWord } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { navigationInsets } from '@/shared/lib/navigation-insets';
import { translateText, translateWord } from '@/features/vocab/translate';
import { baseForm, useLemma } from '@/features/vocab/lemma';
import { cefrOf, useCefr } from '@/features/vocab/cefr';
import { VocabularyRating } from '@/features/vocab/VocabularyRating';
import { VocabularyIcon } from '@/features/vocab/VocabularySpeech';
import { ContextSentence } from '@/features/vocab/ContextSentence';
import { captureDataScope } from '@/features/account/dataScope';
import {
  grammarMetadata,
  partOfSpeechLabel,
} from '@/features/vocab/grammar-metadata';
import { usePartOfSpeech } from '@/features/vocab/usePartOfSpeech';
import {
  canPronounce,
  gradeCardWithReceipt,
  replaceReviewRating,
  repairCardBack,
  Rating,
} from './service';
import type { ReviewReceipt } from './service';
import { dictionaryAnswer, reviewAnswer, sameCardContent } from './answer';
import { ReviewAnswerEditor } from './ReviewAnswerEditor';
import { ReviewIcon } from './ReviewIcon';
import './review.css';

const GRADES = [
  {
    rating: Rating.Again,
    icon: 'again',
    ru: 'Снова',
    en: 'Again',
    hintRu: 'Не вспомнил',
    hintEn: 'Did not recall',
  },
  {
    rating: Rating.Hard,
    icon: 'hard',
    ru: 'Трудно',
    en: 'Hard',
    hintRu: 'Вспомнил с трудом',
    hintEn: 'Recalled with effort',
  },
  {
    rating: Rating.Good,
    icon: 'good',
    ru: 'Хорошо',
    en: 'Good',
    hintRu: 'Вспомнил',
    hintEn: 'Recalled',
  },
  {
    rating: Rating.Easy,
    icon: 'easy',
    ru: 'Легко',
    en: 'Easy',
    hintRu: 'Вспомнил сразу',
    hintEn: 'Recalled immediately',
  },
] as const;

export function ReviewCard({
  card,
  onAdvance,
  onSkip,
  correction,
  onBusyChange,
  disabled = false,
  initialRevealed = false,
  onReveal,
}: {
  card: SrsCard;
  onAdvance: (receipt: ReviewReceipt) => void;
  onSkip: () => void;
  correction?: ReviewReceipt;
  onBusyChange?: (busy: boolean) => void;
  disabled?: boolean;
  initialRevealed?: boolean;
  onReveal?: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    canSpeak = useSpeechAvailable();
  const lemma = useLemma(),
    cefr = useCefr(),
    partsOfSpeech = usePartOfSpeech();
  const [currentScope] = useState(captureDataScope);
  const alive = useRef(false),
    locked = useRef(false),
    lookupGeneration = useRef(0);
  const latest = useRef(card);
  latest.current = card;
  const [revealed, setRevealed] = useState(initialRevealed),
    [lookup, setLookup] = useState<'idle' | 'loading' | 'unavailable'>('idle');
  const [repaired, setRepaired] = useState<{
    source: SrsCard;
    text: string;
  } | null>(null);
  const [editing, setEditing] = useState<SrsCard | null>(null),
    [working, setWorking] = useState(false);
  const [error, setError] = useState(''),
    [attempt, setAttempt] = useState<Grade | null>(null);
  const [speaking, setSpeaking] = useState(false),
    [speechError, setSpeechError] = useState('');
  const speechOwned = useRef(false),
    speechGeneration = useRef(0),
    speechTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const region = useRef<HTMLElement>(null),
    ratings = useRef<HTMLDivElement>(null),
    editorButton = useRef<HTMLButtonElement>(null);
  const shown =
    repaired && sameCardContent(card, repaired.source)
      ? { ...card, back: repaired.text }
      : card;
  const answer = reviewAnswer(shown),
    general = dictionaryAnswer(shown);
  const base = card.kind === 'word' ? baseForm(card.front, lemma) : null;
  const rated =
    !card.fromError && canPronounce(card)
      ? cefrOf(card.front, cefr, lemma)
      : null;
  const grammar = grammarMetadata(card, lemma, partsOfSpeech);
  const busy = working || disabled,
    frozen = busy || Boolean(editing) || lookup === 'loading';
  const stopSpeech = () => {
    speechGeneration.current++;
    if (speechTimer.current) clearTimeout(speechTimer.current);
    if (speechOwned.current) cancelSpeech();
    speechOwned.current = false;
    setSpeaking(false);
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      lookupGeneration.current = lookupGeneration.current + 1;
      speechGeneration.current = speechGeneration.current + 1;
      if (speechOwned.current) cancelSpeech();
      if (speechTimer.current) clearTimeout(speechTimer.current);
    };
  }, []);
  useEffect(() => {
    onBusyChange?.(frozen);
    return () => onBusyChange?.(false);
  }, [frozen, onBusyChange]);
  useEffect(() => {
    lookupGeneration.current++;
    setLookup('idle');
  }, [card.front, card.back, card.contextGloss, card.contextSentence]);
  const active = () => alive.current && currentScope();
  const lookupAnswer = async () => {
    if (lookup === 'loading' || !active() || busy) return;
    const generation = ++lookupGeneration.current,
      source = latest.current;
    const valid = () =>
      active() &&
      lookupGeneration.current === generation &&
      sameCardContent(source, latest.current);
    setLookup('loading');
    setError('');
    const timer = setTimeout(() => {
      if (valid()) {
        lookupGeneration.current++;
        setLookup('unavailable');
      }
    }, 25000);
    try {
      const text = await (
        source.kind === 'word' ? translateWord : translateText
      )(source.front);
      if (!valid()) return;
      const saved =
        text && (await repairCardBack(source.id, text, valid, source));
      if (!valid()) return;
      if (saved && text) setRepaired({ source, text });
      setLookup(saved ? 'idle' : 'unavailable');
    } catch {
      if (valid()) setLookup('unavailable');
    } finally {
      clearTimeout(timer);
    }
  };
  const reveal = () => {
    if (disabled || revealed || !active()) return;
    setRevealed(true);
    onReveal?.();
    if (!reviewAnswer(card) && !card.fromError) void lookupAnswer();
  };
  useLayoutEffect(() => {
    if (!revealed) return;
    const frame = requestAnimationFrame(() => {
      if (!region.current || document.querySelector('dialog[open]')) return;
      region.current.focus({ preventScroll: true });
      const box = ratings.current?.getBoundingClientRect(),
        insets = navigationInsets();
      if (box && box.bottom > innerHeight - insets.bottom - 16) {
        const available = innerHeight - insets.top - insets.bottom - 32;
        window.scrollBy({
          top:
            box.height < available
              ? box.bottom - (innerHeight - insets.bottom - 16)
              : box.top - insets.top - 16,
          behavior: 'instant',
        });
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [revealed]);
  const grade = async (rating: Grade) => {
    if (locked.current || !revealed || frozen || !answer || !active()) return;
    locked.current = true;
    onBusyChange?.(true);
    setWorking(true);
    setError('');
    setAttempt(rating);
    stopSpeech();
    try {
      const receipt = correction
        ? await replaceReviewRating(correction, rating, shown)
        : await gradeCardWithReceipt(
            card.id,
            rating,
            card.card.reps,
            shown,
            currentScope
          );
      if (receipt && currentScope()) onAdvance(receipt);
      else if (active())
        setError(
          ru
            ? 'Карточка изменилась. Вернитесь к обзору и обновите очередь.'
            : 'The card changed. Return to the overview and refresh the queue.'
        );
    } catch {
      if (active())
        setError(
          ru
            ? 'Не удалось записать повторение. Попробуйте ещё раз.'
            : 'Could not record the review. Please try again.'
        );
    } finally {
      locked.current = false;
      if (active()) setWorking(false);
    }
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        document.querySelector('dialog[open]')
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest(
          'button,a,input,textarea,select,summary,[contenteditable="true"],[role="button"]'
        )
      )
        return;
      if (disabled || frozen) return;
      if (event.code === 'Space' && !revealed) {
        event.preventDefault();
        reveal();
      } else if (revealed && /^[1-4]$/.test(event.key) && answer) {
        event.preventDefault();
        void grade(Number(event.key) as Grade);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const speak = () => {
    const was = speaking;
    stopSpeech();
    setSpeechError('');
    if (was) return;
    const generation = speechGeneration.current;
    speechOwned.current = true;
    setSpeaking(true);
    const finish = (failed = false) => {
      if (!active() || generation !== speechGeneration.current) return;
      speechOwned.current = false;
      setSpeaking(false);
      if (speechTimer.current) clearTimeout(speechTimer.current);
      if (failed)
        setSpeechError(
          ru
            ? 'Озвучка недоступна. Проверьте английский голос в настройках.'
            : 'Speech unavailable. Check the English voice in Settings.'
        );
    };
    speechTimer.current = setTimeout(() => {
      if (generation === speechGeneration.current) {
        cancelSpeech();
        finish(true);
      }
    }, 30000);
    try {
      speakWord(card.front, {
        onEnd: () => finish(),
        onError: () => finish(true),
      });
    } catch {
      finish(true);
    }
  };
  return (
    <>
      <section
        ref={region}
        tabIndex={-1}
        className="rv-study-card"
        aria-label={ru ? 'Текущая карточка' : 'Current card'}
      >
        <div className="rv-study-meta">
          <div>
            <span className="rv-chip">
              {card.fromError
                ? ru
                  ? 'Из ошибки'
                  : 'From a mistake'
                : card.kind === 'phrase'
                  ? ru
                    ? 'Фраза'
                    : 'Phrase'
                  : card.kind === 'grammar-pattern'
                    ? ru
                      ? 'Грамматика'
                      : 'Grammar'
                    : ru
                      ? 'Слово'
                      : 'Word'}
            </span>
            <span>
              {card.fromError
                ? ru
                  ? 'Прежнее упражнение'
                  : 'Previous exercise'
                : card.kind === 'grammar-pattern'
                  ? ru
                    ? 'Учебная карточка'
                    : 'Course card'
                  : ru
                    ? 'Мой словарь'
                    : 'My vocabulary'}
            </span>
          </div>
          {!card.fromError && card.kind !== 'grammar-pattern' && (
            <div className="rv-cefr">
              <span>{ru ? 'Полезность' : 'Usefulness'}</span>
              <VocabularyRating hit={rated} />
            </div>
          )}
        </div>
        <div className="rv-front-line">
          <h2 lang="en">{card.front}</h2>
          {canPronounce(card) && canSpeak && (
            <button
              type="button"
              className="rv-speaker"
              disabled={disabled}
              aria-pressed={speaking}
              aria-label={`${speaking ? (ru ? 'Остановить' : 'Stop') : ru ? 'Произнести' : 'Pronounce'} ${card.front}`}
              onClick={speak}
            >
              <VocabularyIcon name="speaker" />
            </button>
          )}
        </div>
        {grammar.partsOfSpeech.length > 0 && (
          <p className="rv-grammar">
            {grammar.partsOfSpeech
              .map((pos) => partOfSpeechLabel(pos, ru ? 'ru' : 'en'))
              .join(' / ')}
            {grammar.infinitive && (
              <>
                {' '}
                · <span lang="en">{grammar.infinitive}</span>
              </>
            )}
          </p>
        )}
        {card.contextSentence && (
          <ContextSentence
            text={card.contextSentence}
            term={card.front}
            isPhrase={card.kind === 'phrase'}
            data={lemma}
            className="rv-context"
          />
        )}
        {!revealed ? (
          <p className="rv-recall">
            {ru
              ? 'Вспомните значение, затем сверьтесь с ответом.'
              : 'Recall the meaning, then check the answer.'}
          </p>
        ) : (
          <div className="rv-answer">
            <div role="status" aria-live="polite">
              <p className="rv-help">
                {card.contextGloss?.trim()
                  ? ru
                    ? 'В этом контексте'
                    : 'In this context'
                  : ru
                    ? 'Ответ'
                    : 'Answer'}
              </p>
              <p className="rv-answer-value">
                {answer ??
                  (lookup === 'loading'
                    ? ru
                      ? 'Ищем перевод…'
                      : 'Looking up translation…'
                    : ru
                      ? 'Перевод недоступен. Введите ответ или пропустите карточку.'
                      : 'Translation unavailable. Enter an answer or skip this card.')}
              </p>
              {card.contextGloss?.trim() &&
                general &&
                general !== card.contextGloss && (
                  <p className="rv-help">
                    {ru ? 'Общий перевод' : 'General translation'}: {general}
                  </p>
                )}
            </div>
            {lookup === 'loading' && (
              <Button
                variant="ghost"
                onClick={() => {
                  lookupGeneration.current++;
                  setLookup('unavailable');
                }}
              >
                {ru ? 'Отменить поиск' : 'Cancel lookup'}
              </Button>
            )}
            {!card.fromError && (
              <details className="rv-answer-tools">
                <summary>
                  {ru ? 'Об ответе и карточке' : 'About this answer and card'}
                </summary>
                {base && (
                  <p>
                    {ru ? 'Базовая форма' : 'Base form'}:{' '}
                    <span lang="en">{base}</span>
                  </p>
                )}
                <p className="rv-help">
                  {ru
                    ? 'Полезность — условная шкала по CEFR, не частотность и не оценка ваших знаний.'
                    : 'Usefulness is an approximate CEFR guide, not frequency or a measure of your knowledge.'}
                </p>
                <div className="rv-actions">
                  <Button
                    ref={editorButton}
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      lookupGeneration.current++;
                      setLookup('idle');
                      setEditing(shown);
                    }}
                  >
                    {ru ? 'Исправить ответ' : 'Edit answer'}
                  </Button>
                  {!answer && (
                    <Button
                      variant="ghost"
                      disabled={busy || lookup === 'loading'}
                      onClick={() => void lookupAnswer()}
                    >
                      {ru ? 'Повторить поиск' : 'Retry lookup'}
                    </Button>
                  )}
                </div>
              </details>
            )}
          </div>
        )}
        <p role="status" className="rv-help">
          {speechError}
        </p>
      </section>
      <div className="rv-study-action">
        {revealed ? (
          <>
            <h2 className="rv-rating-title">
              {ru ? 'Как удалось вспомнить?' : 'How well did you recall?'}
            </h2>
            <div
              ref={ratings}
              className="rv-ratings"
              role="group"
              aria-label={ru ? 'Оцените карточку' : 'Grade the card'}
            >
              {GRADES.map((item, index) => (
                <button
                  key={item.rating}
                  type="button"
                  className="rv-rate"
                  data-rating={item.rating}
                  aria-label={`${ru ? item.ru : item.en}: ${ru ? item.hintRu : item.hintEn}`}
                  disabled={!answer || frozen}
                  onClick={() => void grade(item.rating)}
                >
                  <span className="rv-rate-top">
                    <ReviewIcon name={item.icon} />
                    <kbd aria-hidden="true">{index + 1}</kbd>
                  </span>
                  <b>{ru ? item.ru : item.en}</b>
                  <small>{ru ? item.hintRu : item.hintEn}</small>
                </button>
              ))}
            </div>
            <p className="rv-shortcuts">
              {ru
                ? 'Клавиши 1–4 — выбрать оценку'
                : 'Keys 1–4 — choose a rating'}
            </p>
          </>
        ) : (
          <>
            <Button className="rv-reveal" disabled={disabled} onClick={reveal}>
              {ru ? 'Показать ответ' : 'Show answer'}
            </Button>
            <p className="rv-shortcuts">
              <kbd>{ru ? 'Пробел' : 'Space'}</kbd>
              {ru ? ' — открыть ответ' : ' — show answer'}
            </p>
          </>
        )}
      </div>
      {error && (
        <div className="rv-recovery">
          <p role="alert" className="rv-error">
            {error}
          </p>
          {attempt && (
            <Button
              variant="ghost"
              disabled={frozen}
              onClick={() => void grade(attempt)}
            >
              {ru ? 'Повторить запись оценки' : 'Retry saving rating'}
            </Button>
          )}
        </div>
      )}
      <p role="status" className="rv-pending">
        {working ? (ru ? 'Сохраняем…' : 'Saving…') : ''}
      </p>
      {!correction && (
        <div className="rv-session-foot">
          <button
            type="button"
            className="rv-text-button"
            disabled={frozen}
            onClick={onSkip}
          >
            {ru ? 'Пропустить без оценки' : 'Skip without rating'}
          </button>
        </div>
      )}
      {editing && (
        <ReviewAnswerEditor
          source={editing}
          latest={shown}
          onClose={() => {
            setEditing(null);
            requestAnimationFrame(() => editorButton.current?.focus());
          }}
        />
      )}
    </>
  );
}
