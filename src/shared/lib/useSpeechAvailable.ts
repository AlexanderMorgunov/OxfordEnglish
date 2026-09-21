import { useSyncExternalStore } from 'react';
import { canSpeak, subscribeVoices } from './audio';

/**
 * Whether read-aloud can actually speak, as a value the UI re-renders on.
 *
 * `canSpeak()` on its own is a snapshot, which is fine in a browser where the answer never changes.
 * The native engine cannot know synchronously: it answers optimistically, then corrects itself once
 * it has asked the platform whether an en-US voice exists at all. A component that only read the
 * snapshot would keep offering a button that does nothing on a device with no speech installed.
 */
export function useSpeechAvailable(): boolean {
  return useSyncExternalStore(subscribeVoices, canSpeak, () => false);
}
