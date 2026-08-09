import type { Exercise } from '@/content/schema';
import { GapFillExercise } from './GapFillExercise';
import { ChoiceExercise } from './ChoiceExercise';
import { SpotErrorExercise } from './SpotErrorExercise';
import { MatchExercise } from './MatchExercise';
import { OrderWordsExercise } from './OrderWordsExercise';
import { DictationExercise } from './DictationExercise';
import { TranslateExercise } from './TranslateExercise';
import { TransformExercise } from './TransformExercise';
import { MinimalPairsExercise } from './MinimalPairsExercise';

type Props = { exercise: Exercise; onSolved?: () => void };

export function ExerciseView({ exercise, onSolved }: Props) {
  switch (exercise.type) {
    case 'gap-fill':
      return <GapFillExercise exercise={exercise} onSolved={onSolved} />;
    case 'choice':
      return <ChoiceExercise exercise={exercise} onSolved={onSolved} />;
    case 'spot-error':
      return <SpotErrorExercise exercise={exercise} onSolved={onSolved} />;
    case 'match':
      return <MatchExercise exercise={exercise} onSolved={onSolved} />;
    case 'order-words':
      return <OrderWordsExercise exercise={exercise} onSolved={onSolved} />;
    case 'dictation':
      return <DictationExercise exercise={exercise} onSolved={onSolved} />;
    case 'translate':
      return <TranslateExercise exercise={exercise} onSolved={onSolved} />;
    case 'transform':
      return <TransformExercise exercise={exercise} onSolved={onSolved} />;
    case 'minimal-pairs':
      return <MinimalPairsExercise exercise={exercise} onSolved={onSolved} />;
  }
}
