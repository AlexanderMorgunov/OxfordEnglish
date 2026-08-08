let current: HTMLAudioElement | null = null;

function stopClip(): void {
  if (current) {
    current.pause();
    current.currentTime = 0;
    current = null;
  }
}

/** Play one clip at a time — stops any previous clip so repeated clicks don't overlap. */
export function playClip(url: string, rate = 1): void {
  stopClip();
  const audio = new Audio(url);
  audio.playbackRate = rate;
  current = audio;
  void audio.play();
}

export const canSpeak = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Speak a word in American English (browser synthesis). Cancels any prior utterance. */
export function speakWord(word: string): void {
  if (!canSpeak()) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    stopClip();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  });
}
