import {
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Link } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { subscribeDataScope } from '@/features/account/dataScope';
import { useVocabularySpeech } from '@/features/vocab/useVocabularySpeech';
import { VocabularySpeak } from '@/features/vocab/VocabularySpeech';
import { VocabularyRating } from '@/features/vocab/VocabularyRating';
import { AppIcon } from '@/shared/ui/AppIcon';
import {
  ABOUT_ENTRIES,
  ABOUT_PHRASE,
  initialAboutDemo,
  aboutDemoReducer,
} from './about-demo';
import type { AboutDemoAction } from './about-demo';

const GRADES = [
  { ru: 'Снова', en: 'Again', hintRu: 'Не вспомнил', hintEn: 'Did not recall' },
  { ru: 'Трудно', en: 'Hard', hintRu: 'С трудом', hintEn: 'With effort' },
  { ru: 'Хорошо', en: 'Good', hintRu: 'Вспомнил', hintEn: 'Recalled' },
  { ru: 'Легко', en: 'Easy', hintRu: 'Сразу', hintEn: 'Immediately' },
];

export function AboutDemo() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    t = (rus: string, eng: string) => (ru ? rus : eng);
  const [state, dispatch] = useReducer(aboutDemoReducer, initialAboutDemo);
  const speech = useVocabularySpeech(),
    [speechTerm, setSpeechTerm] = useState<string | null>(null);
  const { stop } = speech;
  const root = useRef<HTMLElement>(null),
    focusNext = useRef<string | null>(null);
  const entry = state.selected ? ABOUT_ENTRIES[state.selected] : null;
  const stored = state.selected ? state.records[state.selected] : undefined;
  const phase = state.stage === 'read' ? 1 : state.stage === 'saved' ? 2 : 3;
  const act = (action: AboutDemoAction, focus?: string) => {
    speech.stop();
    setSpeechTerm(null);
    focusNext.current = focus ?? null;
    dispatch(action);
  };
  useEffect(
    () =>
      subscribeDataScope(() => {
        dispatch({ type: 'reset' });
      }),
    []
  );
  useEffect(() => {
    window.addEventListener('pagehide', stop);
    return () => window.removeEventListener('pagehide', stop);
  }, [stop]);
  useLayoutEffect(() => {
    const selector = focusNext.current;
    focusNext.current = null;
    if (selector) root.current?.querySelector<HTMLElement>(selector)?.focus();
  }, [state]);
  const rangeComplete = state.range?.[1] !== null && Boolean(state.range);
  const low = state.range
    ? Math.min(state.range[0], state.range[1] ?? state.range[0])
    : -1;
  const high = state.range
    ? Math.max(state.range[0], state.range[1] ?? state.range[0])
    : -1;
  const termHead = entry && (
    <div className="ab-demo-result-head">
      <div className="ab-demo-result-title">
        <h3 lang="en">{entry.term}</h3>
        <VocabularySpeak
          term={entry.term}
          speech={{
            ...speech,
            speak: (term) => {
              setSpeechTerm(term);
              speech.speak(term);
            },
          }}
        />
      </div>
      <div className="ab-cefr">
        <span>{t('Полезность', 'Usefulness')}</span>
        <VocabularyRating hit={{ level: entry.level, order: 0 }} />
      </div>
    </div>
  );
  const readButton = (
    <button
      className="ab-btn ab-quiet"
      type="button"
      onClick={() => act({ type: 'read' }, '#about-demo-title')}
    >
      {t('К чтению', 'Back to reading')}
    </button>
  );
  const reviewButton = (
    <button
      className="ab-btn ab-primary"
      type="button"
      onClick={() => act({ type: 'review' }, '#about-demo-title')}
    >
      {t('Попробовать повторение', 'Try reviewing')}
    </button>
  );
  return (
    <section
      id="live-demo"
      ref={root}
      tabIndex={-1}
      className="ab-live-demo"
      aria-label={t(
        'Интерактивный пример чтения и повторения',
        'Interactive reading and review example'
      )}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.repeat ||
          event.nativeEvent.isComposing ||
          event.ctrlKey ||
          event.altKey ||
          event.metaKey ||
          state.stage !== 'review'
        )
          return;
        if (
          event.target instanceof Element &&
          event.target.closest(
            'button,a,input,select,textarea,summary,[contenteditable="true"]'
          )
        )
          return;
        if (event.code === 'Space' && !state.revealed) {
          event.preventDefault();
          act({ type: 'reveal' }, '#about-demo-title');
        } else if (state.revealed && /^[1-4]$/.test(event.key)) {
          event.preventDefault();
          act({ type: 'grade', value: Number(event.key) }, '#about-demo-done');
        }
      }}
    >
      <div className="ab-demo-head">
        <div>
          <h2 id="about-demo-title" tabIndex={-1}>
            {t('Попробуйте прямо здесь', 'Try it right here')}
          </h2>
          <p>
            {t('Короткий интерактивный пример', 'A short interactive example')}
          </p>
        </div>
        {state.stage === 'read' && (
          <div
            className="ab-demo-mode"
            role="group"
            aria-label={t('Что попробовать', 'Choose an example')}
          >
            <button
              type="button"
              aria-pressed={state.mode === 'word'}
              onClick={() => act({ type: 'mode', mode: 'word' })}
            >
              {t('Слово', 'Word')}
            </button>
            <button
              type="button"
              aria-pressed={state.mode === 'phrase'}
              onClick={() => act({ type: 'mode', mode: 'phrase' })}
            >
              {t('Фраза', 'Phrase')}
            </button>
          </div>
        )}
      </div>
      {state.stage === 'read' && (
        <>
          <div className="ab-book-page">
            <p className="ab-book-heading">
              <AppIcon name="library" />
              {t(
                'A quiet morning · пример текста',
                'A quiet morning · sample text'
              )}
            </p>
            <div className="ab-book-text" lang="en">
              <p>
                The{' '}
                {state.mode === 'word' ? (
                  <button
                    type="button"
                    className="ab-word"
                    aria-label={t(
                      'Перевести слово journey',
                      'Translate journey'
                    )}
                    aria-pressed={state.selected === 'journey'}
                    onClick={() => act({ type: 'word', id: 'journey' })}
                  >
                    journey
                  </button>
                ) : (
                  'journey'
                )}{' '}
                begins on a{' '}
                {state.mode === 'word' ? (
                  <button
                    type="button"
                    className="ab-word"
                    aria-label={t('Перевести слово serene', 'Translate serene')}
                    aria-pressed={state.selected === 'serene'}
                    onClick={() => act({ type: 'word', id: 'serene' })}
                  >
                    serene
                  </button>
                ) : (
                  'serene'
                )}{' '}
                morning.
              </p>
              <p>
                {state.mode === 'phrase'
                  ? ABOUT_PHRASE.map((word, index) => (
                      <span key={word}>
                        <button
                          type="button"
                          className="ab-phrase-token"
                          aria-pressed={index >= low && index <= high}
                          onClick={() => act({ type: 'token', index })}
                        >
                          {word}
                        </button>{' '}
                      </span>
                    ))
                  : 'Take your time '}
                and enjoy the view.
              </p>
            </div>
          </div>
          <p className="ab-demo-instruction">
            {state.mode === 'word'
              ? t(
                  'Нажмите подчёркнутое слово — например, journey.',
                  'Tap an underlined word, such as journey.'
                )
              : !state.range
                ? t(
                    'Выберите начало фразы: Take. Можно начать и с последнего слова.',
                    'Select the first word, Take. You can also start from the last word.'
                  )
                : !rangeComplete
                  ? t(
                      'Теперь нажмите другое слово, чтобы завершить фразу.',
                      'Now tap the other end of the phrase.'
                    )
                  : t(
                      'Фраза выбрана. Посмотрите значение и решите, сохранять ли её.',
                      'The phrase is selected. Check its meaning and choose whether to save it.'
                    )}
          </p>
          {entry ? (
            <div className="ab-demo-result">
              {termHead}
              <p className="ab-demo-meaning">{t(entry.ru, entry.en)}</p>
              {stored && (
                <p className="ab-demo-saved">
                  ✓{' '}
                  {t(
                    'Уже сохранено в этом примере',
                    'Already saved in this example'
                  )}
                </p>
              )}
              <div className="ab-actions">
                {stored ? (
                  reviewButton
                ) : (
                  <button
                    type="button"
                    className="ab-btn ab-primary"
                    onClick={() => act({ type: 'save' }, '[data-demo-review]')}
                    data-demo-save
                  >
                    {entry.kind === 'phrase'
                      ? t('Сохранить фразу', 'Save phrase')
                      : t('Сохранить слово', 'Save word')}
                  </button>
                )}
                {readButton}
              </div>
            </div>
          ) : rangeComplete ? (
            <div className="ab-demo-result">
              <h3 lang="en">{ABOUT_PHRASE.slice(low, high + 1).join(' ')}</h3>
              <p className="ab-demo-feedback" role="status">
                {t(
                  'Для этой части фразы нет подготовленного ответа. Выберите Take и time, чтобы попробовать фразу целиком.',
                  'There is no prepared answer for this range. Select Take and time to try the full phrase.'
                )}
              </p>
              {readButton}
            </div>
          ) : (
            <p className="ab-demo-placeholder">
              {t(
                'Перевод появится здесь. Сам просмотр значения ещё не добавляет запись в словарь.',
                'The meaning appears here. Looking it up does not save a vocabulary entry.'
              )}
            </p>
          )}
        </>
      )}
      {state.stage === 'saved' && entry && (
        <div className="ab-demo-result">
          <p className="ab-demo-saved" role="status">
            ✓ {t('Сохранено в примере', 'Saved in this example')}
          </p>
          {termHead}
          <p className="ab-demo-meaning">{t(entry.ru, entry.en)}</p>
          <p className="ab-demo-feedback">
            {t(
              'Теперь можно проверить, как вспоминается это значение.',
              'Now try recalling this meaning.'
            )}
          </p>
          <div className="ab-actions">
            <button
              type="button"
              className="ab-btn ab-primary"
              data-demo-review
              onClick={() => act({ type: 'review' }, '#about-demo-title')}
            >
              {t('Попробовать повторение', 'Try reviewing')}
            </button>
            {readButton}
          </div>
        </div>
      )}
      {state.stage === 'review' && entry && (
        <>
          <div className="ab-demo-actions-row">
            <button
              type="button"
              className="ab-text-button"
              onClick={() => act({ type: 'read' }, '#about-demo-title')}
            >
              {t('← К примеру чтения', '← Back to the reading example')}
            </button>
            <span>{t('Пример повторения', 'Review example')}</span>
          </div>
          <div className="ab-review-example">
            {termHead}
            {state.revealed ? (
              <p className="ab-demo-meaning" role="status">
                {t(entry.ru, entry.en)}
              </p>
            ) : (
              <p className="ab-demo-feedback">
                {t(
                  'Вспомните значение, затем откройте ответ.',
                  'Recall the meaning, then show the answer.'
                )}
              </p>
            )}
          </div>
          {state.revealed ? (
            <div
              className="ab-demo-grades"
              role="group"
              aria-label={t('Оцените, как вспомнили', 'Rate your recall')}
            >
              {GRADES.map((grade, index) => (
                <button
                  type="button"
                  className="ab-demo-grade"
                  key={grade.en}
                  aria-label={`${t(grade.ru, grade.en)}: ${t(grade.hintRu, grade.hintEn)}`}
                  onClick={() =>
                    act({ type: 'grade', value: index + 1 }, '#about-demo-done')
                  }
                >
                  {t(grade.ru, grade.en)}
                  <small>{t(grade.hintRu, grade.hintEn)}</small>
                </button>
              ))}
            </div>
          ) : (
            <button
              type="button"
              className="ab-btn ab-primary ab-demo-reveal"
              onClick={() => act({ type: 'reveal' }, '#about-demo-title')}
            >
              {t('Показать ответ', 'Show answer')}
            </button>
          )}
        </>
      )}
      {state.stage === 'done' && entry && stored?.grade && (
        <div className="ab-demo-done">
          <p className="ab-demo-saved" role="status">
            ✓ {t('Пример пройден', 'Example completed')}
          </p>
          <h3 tabIndex={-1} id="about-demo-done">
            {t('От чтения — к повторению', 'From reading to review')}
          </h3>
          <div className="ab-demo-pair">
            <strong lang="en">{entry.term}</strong>
            <span>{t(entry.ru, entry.en)}</span>
          </div>
          <p>
            {t('Ваша оценка в примере', 'Your example rating')}:{' '}
            <strong>
              {t(GRADES[stored.grade - 1]!.ru, GRADES[stored.grade - 1]!.en)}
            </strong>
            .{' '}
            {t(
              'В приложении следующие повторения подбираются по вашим ответам.',
              'In the app, your answers help schedule future reviews.'
            )}
          </p>
          <div className="ab-actions">
            <Link className="ab-btn ab-primary" to="/review">
              {t('Открыть повторение', 'Open review')} →
            </Link>
            <button
              type="button"
              className="ab-btn ab-quiet"
              onClick={() => act({ type: 'read' }, '#about-demo-title')}
            >
              {t('Попробовать ещё', 'Try another')}
            </button>
            <button
              type="button"
              className="ab-text-button"
              onClick={() => act({ type: 'change-grade' }, '#about-demo-title')}
            >
              {t('Изменить оценку примера', 'Change example rating')}
            </button>
          </div>
        </div>
      )}
      <p className="ab-demo-feedback" role="status">
        {speechTerm === entry?.term ? speech.error : ''}
      </p>
      <ol
        className="ab-demo-stepper"
        aria-label={t('Путь слова в примере', 'Example word journey')}
      >
        {[
          t('Читаете', 'Read'),
          t('Сохраняете', 'Save'),
          t('Вспоминаете', 'Recall'),
        ].map((label, index) => (
          <li
            key={index}
            aria-current={phase === index + 1 ? 'step' : undefined}
          >
            <i>{index + 1}</i>
            {label}
          </li>
        ))}
      </ol>
      <p className="ab-demo-saved-count" role="status">
        {t('Записей в примере', 'Example entries')}:{' '}
        <b>{Object.keys(state.records).length}</b>
      </p>
      <p className="ab-demo-note">
        {t(
          'Демо с подготовленными ответами. Ваш словарь в приложении не изменяется.',
          'A demo with prepared answers. Your app vocabulary is unchanged.'
        )}{' '}
        <button
          type="button"
          className="ab-text-button"
          onClick={() => act({ type: 'reset' }, '#about-demo-title')}
        >
          {t('Начать пример сначала', 'Restart example')}
        </button>
      </p>
    </section>
  );
}
