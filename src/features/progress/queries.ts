import { db, type CheckpointResult, type ExerciseAttempt } from '@/db/db';
import { addCheckpoint } from '@/features/sync/local';

export async function loadAttempts(): Promise<ExerciseAttempt[]> {
  try {
    return await db.attempts.toArray();
  } catch {
    return [];
  }
}

export async function vocabSize(): Promise<number> {
  try {
    const rows = await db.wordStatus.toArray();
    return rows.filter((w) => w.status === 'known' || w.status === 'learning').length;
  } catch {
    return 0;
  }
}

export async function checkpointHistory(): Promise<CheckpointResult[]> {
  try {
    return (await db.checkpoints.orderBy('timestamp').reverse().toArray()).slice(0, 10);
  } catch {
    return [];
  }
}

export async function saveCheckpoint(result: Omit<CheckpointResult, 'id' | 'syncId'>): Promise<void> {
  try {
    await addCheckpoint(result);
  } catch {
    // best-effort
  }
}
