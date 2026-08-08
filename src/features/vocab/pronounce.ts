export const canPronounce = () =>
  typeof window !== 'undefined' && 'speechSynthesis' in window;

/** Speak a word in American English via the browser's speech synthesis (offline, OS voices). */
export function pronounce(word: string): void {
  if (!canPronounce()) return;
  const utterance = new SpeechSynthesisUtterance(word);
  utterance.lang = 'en-US';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}
