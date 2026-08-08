import { useState } from 'react';
import type { Section } from '@/content/schema';
import { ProgressBar } from '@/shared/ui';
import { ExerciseView } from './exercises/ExerciseView';

type Props = { section: Extract<Section, { type: 'practice' }> };

export function PracticeSectionView({ section }: Props) {
  const [solved, setSolved] = useState<Set<string>>(new Set());
  const markSolved = (id: string) =>
    setSolved((prev) => (prev.has(id) ? prev : new Set(prev).add(id)));

  return (
    <div className="flex flex-col gap-3.5">
      <ProgressBar
        value={solved.size}
        max={section.exercises.length}
        label="solved"
      />
      {section.exercises.map((exercise) => (
        <ExerciseView
          key={exercise.id}
          exercise={exercise}
          onSolved={() => markSolved(exercise.id)}
        />
      ))}
    </div>
  );
}
