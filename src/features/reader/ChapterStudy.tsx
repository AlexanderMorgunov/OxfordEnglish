import { useEffect, useMemo, useState } from 'react';
import type { Exercise } from '@/content/schema';
import { Button, Card } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { useLearner } from '@/features/learner/store';
import { ExerciseView } from '@/features/practice/exercises/ExerciseView';
import { useAiStore, isConfigured } from '@/features/ai/store';
import { generateReaderExercises } from '@/features/ai/functions';
import { estimateCoverage, loadFreq, rankThresholdFor, type FreqIndex } from './difficulty';
import { generateExercises } from './exercises';

export function ChapterStudy({ text, idPrefix }: { text: string; idPrefix: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const level = useLearner((s) => s.level);
  const statuses = useVocabStore((s) => s.statuses);
  const loadVocab = useVocabStore((s) => s.load);
  const aiConfig = useAiStore((s) => s.config);
  const aiReady = isConfigured(aiConfig);
  const [freq, setFreq] = useState<FreqIndex | null>(null);
  const [exercises, setExercises] = useState<Exercise[] | null>(null);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'error'>('idle');

  useEffect(() => {
    void loadVocab();
    void loadFreq().then(setFreq);
  }, [loadVocab]);

  const known = useMemo(() => {
    const set = new Set<string>();
    for (const [word, status] of statuses) if (status === 'known') set.add(word);
    return set;
  }, [statuses]);

  const rankThreshold = rankThresholdFor(level);
  const coverage = useMemo(
    () => (freq ? estimateCoverage(text, { freq, known, rankThreshold }) : null),
    [freq, text, known, rankThreshold]
  );

  useEffect(() => {
    setExercises(null);
    setAiState('idle');
  }, [text]);

  // Hide the panel rather than show a misleading "0%" if the frequency list failed to load.
  if (!coverage || coverage.total < 20 || (freq && freq.size === 0)) return null;

  const pct = Math.round(coverage.coverage * 100);
  const verdict = ru
    ? pct >= 95
      ? 'комфортно'
      : pct >= 90
        ? 'нормально'
        : 'сложновато'
    : pct >= 95
      ? 'comfortable'
      : pct >= 90
        ? 'okay'
        : 'challenging';
  const tone = pct >= 95 ? 'text-teal' : pct >= 90 ? 'text-content' : 'text-amber';

  const generate = () => {
    if (!freq) return;
    setExercises(
      generateExercises(text, { freq, known, rankThreshold, idPrefix, count: 8 })
    );
  };

  const generateAi = async () => {
    if (!coverage || !isConfigured(aiConfig)) return;
    setAiState('loading');
    try {
      const targets = [...coverage.unknown.keys()];
      const made = await generateReaderExercises(aiConfig, { text, targets, idPrefix });
      setExercises(made);
      setAiState(made.length ? 'idle' : 'error');
    } catch {
      setAiState('error');
    }
  };

  return (
    <Card className="mt-8 border-line">
      <p className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
        {ru ? 'сложность главы' : 'chapter difficulty'}
      </p>
      <p className="mt-2 text-sm">
        {ru ? 'Вы знаете примерно ' : 'You know about '}
        <span className={`font-mono tabular-nums ${tone}`}>{pct}%</span>
        {ru ? ' слов — ' : ' of the words — '}
        <span className={tone}>{verdict}</span>.
        {level ? '' : ru ? ' Пройди тест уровня для точности.' : ' Take a placement test for accuracy.'}
      </p>

      {exercises === null ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={generate}>
            {ru ? 'Упражнения из этой главы' : 'Exercises from this chapter'}
          </Button>
          {aiReady && (
            <Button
              variant="ghost"
              className="border-violet-dim text-violet"
              disabled={aiState === 'loading'}
              onClick={() => void generateAi()}
            >
              {aiState === 'loading'
                ? ru
                  ? 'AI думает…'
                  : 'AI thinking…'
                : ru
                  ? 'AI-упражнения'
                  : 'AI exercises'}
            </Button>
          )}
          {aiState === 'error' && (
            <span className="font-mono text-2xs text-coral">
              {ru ? 'AI не справился — попробуй детерминированные' : 'AI failed — try the deterministic set'}
            </span>
          )}
        </div>
      ) : exercises.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          {ru
            ? 'В этой главе почти нет новых слов для вас — отличная работа!'
            : 'Barely any new words for you in this chapter — great job!'}
        </p>
      ) : (
        <div className="mt-4 flex flex-col gap-3.5">
          <p className="text-sm text-muted">
            {ru
              ? 'Слова из главы, которые стоит закрепить:'
              : 'Words from the chapter worth practising:'}
          </p>
          {exercises.map((exercise) => (
            <ExerciseView key={exercise.id} exercise={exercise} />
          ))}
        </div>
      )}
    </Card>
  );
}
