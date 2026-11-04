const reasons = new Set<symbol>();
const listeners = new Set<() => void>();

export const readingSuspended = () => reasons.size > 0;
export function suspendReading(): () => void {
  const reason = Symbol('reading-overlay');
  reasons.add(reason);
  for (const listener of listeners) listener();
  return () => {
    if (!reasons.delete(reason)) return;
    for (const listener of listeners) listener();
  };
}
export function subscribeReadingSuspension(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
