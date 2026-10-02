let generation = 0;
const listeners = new Set<() => void>();

export function invalidateDataScope(): void {
  generation += 1;
  for (const listener of listeners) listener();
}

export function captureDataScope(): () => boolean {
  const captured = generation;
  return () => captured === generation;
}

export function subscribeDataScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function requireDataScope(current: () => boolean): void {
  if (!current()) throw new Error('Data owner changed');
}
