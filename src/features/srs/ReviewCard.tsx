import { useEffect, useRef, useState } from 'react';
import type { Grade } from 'ts-fsrs';
import type { SrsCard } from '@/db/db';
import { Button, Card, Input } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { speakWord } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { translateText, translateWord } from '@/features/vocab/translate';
import { baseForm, useLemma } from '@/features/vocab/lemma';
import { cefrOf, useCefr } from '@/features/vocab/cefr';
import { CefrChip } from '@/features/vocab/CefrChip';
import { ContextSentence } from '@/features/vocab/ContextSentence';
import { editCardAnswer, sameCardContent } from '@/features/vocab/manage';
import { captureDataScope } from '@/features/account/dataScope';
import { useAiStore } from '@/features/ai/store';
import { useAiEnabled, useAiUnknown } from '@/features/ai/route';
import { aiTranslate } from '@/features/ai/functions';
import { canPronounce, gradeCard, repairCardBack, Rating } from './service';
import { dictionaryAnswer, reviewAnswer } from './answer';

const GRADES = [
  { rating: Rating.Again, ru: 'снова', en: 'again' },
  { rating: Rating.Hard, ru: 'трудно', en: 'hard' },
  { rating: Rating.Good, ru: 'хорошо', en: 'good' },
  { rating: Rating.Easy, ru: 'легко', en: 'easy' },
] as const;

export function ReviewCard({
  card,
  onAdvance,
  onSkip,
}: {
  card: SrsCard;
  onAdvance: () => void;
  onSkip: () => void;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const canSpeak = useSpeechAvailable();
  const lemma = useLemma();
  const cefr = useCefr();
  const config = useAiStore((s) => s.config);
  const aiReady = useAiEnabled();
  const aiUnknown = useAiUnknown();
  const [currentScope] = useState(captureDataScope);
  const alive = useRef(true);
  const latest = useRef(card);
  latest.current = card;
  const locked = useRef(false);
  const lookingUp = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'unavailable'>(
    'idle'
  );
  const [extra, setExtra] = useState<string>();
  const [editing, setEditing] = useState<SrsCard | null>(null);
  const [translation, setTranslation] = useState('');
  const [contextGloss, setContextGloss] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [proposal, setProposal] = useState<{
    text: string;
    source: SrsCard;
  } | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setExtra(undefined);
  }, [card.back, card.contextGloss]);
  const active = () => alive.current && currentScope();
  const answer = reviewAnswer(card) ?? extra;
  const general = dictionaryAnswer(card);
  const base = card.kind === 'word' ? baseForm(card.front, lemma) : null;
  const rated = cefrOf(card.front, cefr, lemma);

  const lookupAnswer = async () => {
    if (lookingUp.current || !active()) return;
    lookingUp.current = true;
    setLookup('loading');
    const source = latest.current;
    try {
      const text = await (
        source.kind === 'word' ? translateWord : translateText
      )(source.front);
      if (!active() || !sameCardContent(source, latest.current)) return;
      if (text) {
        await repairCardBack(source.id, text, currentScope, source);
        if (active() && sameCardContent(source, latest.current)) setExtra(text);
      }
      if (active()) setLookup(text ? 'idle' : 'unavailable');
    } catch {
      if (active()) setLookup('unavailable');
    } finally {
      lookingUp.current = false;
      if (active() && !sameCardContent(source, latest.current))
        setLookup('idle');
    }
  };
  const reveal = () => {
    setRevealed(true);
    if (!reviewAnswer(card) && !card.fromError) void lookupAnswer();
  };
  const startEdit = () => {
    setEditing(card);
    setTranslation(general ?? extra ?? '');
    setContextGloss(card.contextGloss ?? '');
    setError('');
  };
  const save = async () => {
    if (!editing || locked.current || !active()) return;
    locked.current = true;
    setBusy(true);
    try {
      const saved = await editCardAnswer(
        editing,
        translation,
        contextGloss,
        currentScope
      );
      if (!active()) return;
      if (!saved)
        setError(
          ru
            ? 'Карточка изменилась. Отмените правку и откройте её заново.'
            : 'The card changed. Cancel and reopen the editor.'
        );
      else {
        setExtra(undefined);
        setEditing(null);
        setProposal(null);
        setError('');
      }
    } catch {
      if (active())
        setError(
          ru
            ? 'Не удалось сохранить. Попробуйте ещё раз.'
            : 'Could not save. Please try again.'
        );
    } finally {
      locked.current = false;
      if (active()) setBusy(false);
    }
  };
  const suggest = async () => {
    if (aiBusy || !card.contextSentence || !active()) return;
    const source = card;
    setAiBusy(true);
    setError('');
    setProposal(null);
    try {
      const text = await aiTranslate(config, source.front, {
        sentence: source.contextSentence,
      });
      if (active() && sameCardContent(source, latest.current))
        setProposal({ text, source });
    } catch {
      if (active())
        setError(
          ru
            ? 'Контекстный перевод недоступен. Можно исправить ответ вручную.'
            : 'Context translation unavailable. You can edit the answer manually.'
        );
    } finally {
      if (active()) setAiBusy(false);
    }
  };
  const accept = async () => {
    if (!proposal || locked.current || !active()) return;
    locked.current = true;
    setBusy(true);
    try {
      const saved = await editCardAnswer(
        proposal.source,
        dictionaryAnswer(proposal.source) ?? '',
        proposal.text,
        currentScope
      );
      if (!active()) return;
      if (!saved)
        setError(
          ru
            ? 'Карточка изменилась. Запросите перевод заново.'
            : 'The card changed. Request a new translation.'
        );
      setProposal(null);
    } catch {
      if (active())
        setError(
          ru
            ? 'Не удалось сохранить перевод.'
            : 'Could not save the translation.'
        );
    } finally {
      locked.current = false;
      if (active()) setBusy(false);
    }
  };
  const grade = async (rating: Grade) => {
    if (locked.current || editing || !answer || !active()) return;
    locked.current = true;
    setBusy(true);
    try {
      const graded = await gradeCard(card.id, rating, card.card.reps, card);
      if (active()) {
        if (graded) onAdvance();
        else
          setError(
            ru
              ? 'Карточка изменилась. Обновите очередь.'
              : 'The card changed. Refresh the queue.'
          );
      }
    } catch {
      if (active())
        setError(
          ru
            ? 'Не удалось записать повторение. Попробуйте ещё раз.'
            : 'Could not record the review. Please try again.'
        );
    } finally {
      locked.current = false;
      if (active()) setBusy(false);
    }
  };

  return (
    <>
      <Card className="min-h-40 break-words">
        <div className="flex items-center gap-2.5">
          <p className="min-w-0 font-mono text-2xl text-content">
            {card.front}
          </p>
          {canPronounce(card) && canSpeak && (
            <button
              type="button"
              aria-label={`${ru ? 'Произнести' : 'Pronounce'} ${card.front}`}
              className="shrink-0 px-2 py-2 text-xl text-teal hover:opacity-80"
              onClick={() => speakWord(card.front)}
            >
              🔊
            </button>
          )}
        </div>
        {card.contextSentence && (
          <ContextSentence
            text={card.contextSentence}
            term={card.front}
            isPhrase={card.kind === 'phrase'}
            data={lemma}
            className="mt-3 border-l-2 border-line pl-3 text-sm text-muted text-pretty"
          />
        )}
        {revealed && (
          <div className="mt-4 border-t border-line pt-4">
            {!card.fromError && (
              <div className="mb-3 flex flex-wrap items-center gap-3">
                {rated && <CefrChip level={rated.level} />}
                {base && (
                  <span className="font-mono text-2xs text-muted">
                    {ru ? 'база' : 'base'}:{' '}
                    <span className="text-content">{base}</span>
                  </span>
                )}
              </div>
            )}
            <div role="status" aria-live="polite">
              {card.contextGloss && (
                <p className="mb-1 font-mono text-2xs uppercase tracking-[0.08em] text-violet">
                  {ru ? 'в контексте' : 'in context'}
                </p>
              )}
              <p
                className={`text-lg ${answer ? 'text-content' : 'text-muted'}`}
              >
                {answer ??
                  (lookup === 'loading'
                    ? ru
                      ? 'Ищем перевод…'
                      : 'Looking up translation…'
                    : ru
                      ? 'Перевод недоступен. Введите ответ или пропустите карточку.'
                      : 'Translation unavailable. Enter an answer or skip this card.')}
              </p>
              {card.contextGloss &&
                general &&
                general !== card.contextGloss && (
                  <p className="mt-2 text-sm text-muted">
                    {ru ? 'Общий перевод' : 'General translation'}: {general}
                  </p>
                )}
            </div>
            {!card.fromError &&
              (editing ? (
                <form
                  className="mt-4 flex flex-col gap-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void save();
                  }}
                >
                  <label className="text-sm text-muted">
                    {ru ? 'Общий перевод' : 'General translation'}
                    <Input
                      autoFocus
                      value={translation}
                      onChange={(e) => setTranslation(e.target.value)}
                      className="mt-1 w-full"
                    />
                  </label>
                  {card.contextSentence && (
                    <label className="text-sm text-muted">
                      {ru ? 'Значение в контексте' : 'Meaning in context'}
                      <Input
                        value={contextGloss}
                        onChange={(e) => setContextGloss(e.target.value)}
                        className="mt-1 w-full"
                      />
                    </label>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button type="submit" size="sm" disabled={busy}>
                      {ru ? 'Сохранить' : 'Save'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => {
                        setEditing(null);
                        setError('');
                      }}
                    >
                      {ru ? 'Отмена' : 'Cancel'}
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy}
                    onClick={startEdit}
                  >
                    {ru ? 'Исправить ответ' : 'Edit answer'}
                  </Button>
                  {!answer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={lookup === 'loading'}
                      onClick={() => void lookupAnswer()}
                    >
                      {ru ? 'Повторить поиск' : 'Retry lookup'}
                    </Button>
                  )}
                  {card.contextSentence && (aiReady || aiUnknown) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={busy || aiBusy}
                      onClick={() => void suggest()}
                    >
                      {aiBusy
                        ? ru
                          ? 'Получаем значение…'
                          : 'Getting meaning…'
                        : ru
                          ? 'Уточнить в контексте · AI'
                          : 'Translate in context · AI'}
                    </Button>
                  )}
                </div>
              ))}
            {proposal && !editing && (
              <div className="mt-3 rounded-sm border border-violet-dim p-3">
                <p className="text-sm text-muted">
                  {ru
                    ? 'Предложение AI — проверьте перед сохранением'
                    : 'AI suggestion — check before saving'}
                </p>
                <p className="my-2 text-content">{proposal.text}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => void accept()}
                  >
                    {ru ? 'Использовать значение' : 'Use this meaning'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setProposal(null)}
                  >
                    {ru ? 'Отклонить' : 'Dismiss'}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
      {error && (
        <p role="alert" className="text-sm text-coral">
          {error}
        </p>
      )}
      {revealed ? (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={ru ? 'Оцените карточку' : 'Grade the card'}
        >
          {GRADES.map((g) => (
            <Button
              key={g.en}
              variant="ghost"
              disabled={
                !answer || busy || Boolean(editing) || lookup === 'loading'
              }
              onClick={() => void grade(g.rating)}
            >
              {ru ? g.ru : g.en}
            </Button>
          ))}
          <Button variant="ghost" disabled={busy} onClick={onSkip}>
            {ru ? 'Пропустить' : 'Skip'}
          </Button>
        </div>
      ) : (
        <Button className="self-start" onClick={reveal}>
          {ru ? 'Показать ответ' : 'Show answer'}
        </Button>
      )}
    </>
  );
}
