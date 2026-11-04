import { useEffect, useRef, useState } from 'react';
import { Button, Option } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { shuffle } from '@/features/practice/shuffle';
import {
  matchingRounds,
  normalizedAnswer,
  type PlayableTerm,
} from './chapter-matching';
import { ReaderIcon } from './ReaderIcon';
import './reader-chapter.css';

function MatchingRound({
  terms,
  onNext,
  last,
  round,
  total,
}: {
  terms: PlayableTerm[];
  onNext: () => void;
  last: boolean;
  round: number;
  total: number;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [left] = useState(() => shuffle(terms));
  const [right] = useState(() => shuffle(terms));
  const [selected, setSelected] = useState<string | null>(null);
  const [matchedLeft, setMatchedLeft] = useState<Set<string>>(() => new Set());
  const [matchedRight, setMatchedRight] = useState<Set<string>>(
    () => new Set()
  );
  const [wrong, setWrong] = useState<string | null>(null);
  const [feedback, setFeedback] = useState('');
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const nextButton = useRef<HTMLButtonElement>(null);
  const complete = matchedLeft.size === terms.length;
  useEffect(() => {
    buttons.current.get(left[0]!.id)?.focus({ preventScroll: true });
  }, [left]);

  const chooseRight = (term: PlayableTerm) => {
    const word = left.find((t) => t.id === selected);
    if (!word || matchedRight.has(term.id)) return;
    if (normalizedAnswer(word.answer) !== normalizedAnswer(term.answer)) {
      setWrong(term.id);
      setFeedback(
        ru
          ? 'Пока не совпало. Попробуйте другой перевод.'
          : 'Not a match yet. Try another translation.'
      );
      return;
    }
    const next = new Set(matchedLeft).add(word.id);
    setMatchedLeft(next);
    setMatchedRight(new Set(matchedRight).add(term.id));
    setSelected(null);
    setWrong(null);
    setFeedback(
      `${word.front} — ${term.answer}. ${ru ? 'Верно.' : 'Correct.'}`
    );
    requestAnimationFrame(() => {
      const remaining = left.find((t) => !next.has(t.id));
      if (remaining)
        buttons.current.get(remaining.id)?.focus({ preventScroll: true });
      else nextButton.current?.focus({ preventScroll: true });
    });
  };

  return (
    <div className="rds-matching-round">
      <p className="rds-practice-count">
        {ru ? 'Раунд' : 'Round'} {round}/{total} · {ru ? 'Пары' : 'Pairs'}{' '}
        {matchedLeft.size}/{terms.length}
      </p>
      <p className="rds-practice-note">
        {ru
          ? 'Выберите слово, затем его перевод.'
          : 'Choose a word, then its translation.'}
      </p>
      <div className="rds-matching-columns">
        <div
          role="group"
          aria-label={ru ? 'Английские слова' : 'English words'}
          className="rds-match-list"
        >
          <h3>{ru ? 'Слово или фраза' : 'Word or phrase'}</h3>
          {left.map((term) => (
            <Option
              key={term.id}
              ref={(el) => {
                if (el) buttons.current.set(term.id, el);
                else buttons.current.delete(term.id);
              }}
              className="rds-match-option"
              state={
                matchedLeft.has(term.id)
                  ? 'correct'
                  : selected === term.id
                    ? 'chosen'
                    : 'default'
              }
              aria-pressed={selected === term.id}
              aria-disabled={matchedLeft.has(term.id)}
              onClick={() => {
                if (!matchedLeft.has(term.id)) {
                  setSelected(term.id);
                  setWrong(null);
                  setFeedback('');
                }
              }}
            >
              {matchedLeft.has(term.id) && <ReaderIcon name="check" />}
              <span lang="en">{term.front}</span>
            </Option>
          ))}
        </div>
        <div
          role="group"
          aria-label={ru ? 'Переводы' : 'Translations'}
          className="rds-match-list"
        >
          <h3>{ru ? 'Значение' : 'Meaning'}</h3>
          {right.map((term) => (
            <Option
              key={term.id}
              className="rds-match-option"
              state={
                matchedRight.has(term.id)
                  ? 'correct'
                  : wrong === term.id
                    ? 'wrong'
                    : 'default'
              }
              aria-disabled={!selected || matchedRight.has(term.id)}
              onClick={() => chooseRight(term)}
            >
              {matchedRight.has(term.id) && <ReaderIcon name="check" />}
              <span lang="ru">{term.answer}</span>
            </Option>
          ))}
        </div>
      </div>
      <p role="status" aria-live="polite" className="rds-match-feedback">
        {feedback}
      </p>
      {complete && (
        <Button ref={nextButton} className="min-h-11" onClick={onNext}>
          {last
            ? ru
              ? 'Завершить'
              : 'Finish'
            : ru
              ? 'Следующий раунд'
              : 'Next round'}
        </Button>
      )}
    </div>
  );
}

export function ChapterMatching({
  terms,
  onExit,
}: {
  terms: PlayableTerm[];
  onExit: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [rounds] = useState(() => matchingRounds(terms));
  const [round, setRound] = useState(0);
  const completion = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (round === rounds.length)
      completion.current?.focus({ preventScroll: true });
  }, [round, rounds.length]);
  return (
    <div className="rds-matching">
      {round < rounds.length ? (
        <MatchingRound
          key={round}
          terms={rounds[round]!}
          round={round + 1}
          total={rounds.length}
          last={round === rounds.length - 1}
          onNext={() => setRound(round + 1)}
        />
      ) : (
        <div className="rds-matching-done">
          <ReaderIcon name="check" />
          <h3>{ru ? 'Все пары найдены' : 'All pairs found'}</h3>
          <p ref={completion} tabIndex={-1} role="status">
            {ru ? 'Практика завершена. Пар:' : 'Practice complete. Pairs:'}{' '}
            {terms.length}
          </p>
          <p className="rds-practice-note">
            {ru
              ? 'Расписание повторений не менялось.'
              : 'Your review schedule is unchanged.'}
          </p>
        </div>
      )}
      <Button variant="ghost" className="rds-matching-exit" onClick={onExit}>
        {ru ? 'К списку слов' : 'Back to words'}
      </Button>
    </div>
  );
}
