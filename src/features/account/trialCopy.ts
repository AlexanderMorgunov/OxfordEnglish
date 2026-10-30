import type { TrialClaim } from './entitlement';

export function trialNote(outcome: Exclude<TrialClaim, 'ok'>, ru: boolean): string {
  if (outcome === 'already-claimed') return ru ? 'Пробный период уже использован на этом устройстве.' : 'The free trial has already been used on this device.';
  if (outcome === 'network') return ru
    ? 'Не удалось связаться с сервером. Если подписка всё же оформилась, она появится здесь сама.'
    : 'Could not reach the server. If the trial did start, it will show up here on its own.';
  return ru ? 'Не получилось начать пробный период. Попробуйте ещё раз.' : 'Could not start the free trial. Please try again.';
}
