let generation = 0;
let ownerGeneration = 0;
export type DataScopeChange = 'reset' | 'adopt-anonymous';
const listeners = new Set<(change: DataScopeChange) => void>();

export function invalidateDataScope(change: DataScopeChange = 'reset'): void {
  generation += 1;
  if (change === 'reset') ownerGeneration += 1;
  for (const listener of listeners) listener(change);
}

export function captureDataScope(): () => boolean {
  const captured = generation;
  return () => captured === generation;
}

export function getDataScopeRevision(): number {
  return generation;
}

export function getDataOwnerRevision(): number {
  return ownerGeneration;
}

export function subscribeDataScope(listener: (change: DataScopeChange) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requireDataScope(current: () => boolean): void {
  if (!current()) throw new Error('Data owner changed');
}
