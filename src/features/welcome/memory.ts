export const WELCOME_KEY = 'dayenglish.first-entry.v2';
const INTENT_PREFIX = 'dayenglish.first-entry-intent.v1:';
const PENDING_PREFIX = 'dayenglish.first-entry-pending.v1:';
const sessionIntents = new Map<string, boolean>();

export function welcomeSeen(): boolean | null {
  try {
    return localStorage.getItem(WELCOME_KEY) !== null;
  } catch {
    return null;
  }
}
export function markWelcomeSeen(): boolean {
  try {
    localStorage.setItem(WELCOME_KEY, 'seen');
    return true;
  } catch {
    return false;
  }
}
export function trialIntent(owner: string): boolean {
  if (sessionIntents.has(owner)) return sessionIntents.get(owner)!;
  try {
    return localStorage.getItem(INTENT_PREFIX + owner) !== 'off';
  } catch {
    return true;
  }
}
export function rememberTrialIntent(owner: string, value: boolean): void {
  sessionIntents.set(owner, value);
  try {
    localStorage.setItem(INTENT_PREFIX + owner, value ? 'on' : 'off');
  } catch {
    /* Keep the choice for this session. */
  }
}
export function trialPending(owner: string): boolean {
  try {
    return localStorage.getItem(PENDING_PREFIX + owner) === 'pending';
  } catch {
    return false;
  }
}
export function rememberTrialPending(owner: string): boolean {
  try {
    localStorage.setItem(PENDING_PREFIX + owner, 'pending');
    return true;
  } catch {
    return false;
  }
}
export function clearTrialPending(owner: string): void {
  try {
    localStorage.removeItem(PENDING_PREFIX + owner);
  } catch {
    /* A read-only reconciliation remains safe. */
  }
}
