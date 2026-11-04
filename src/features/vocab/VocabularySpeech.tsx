import { useUiLang } from '@/features/i18n/uiLang';
import type { useVocabularySpeech } from './useVocabularySpeech';

export function VocabularyIcon({
  name,
}: {
  name: 'speaker' | 'arrow' | 'plus' | 'translate';
}) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === 'speaker' ? (
        <>
          <path d="M11 5 6 9H3v6h3l5 4z" />
          <path d="M15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14" />
        </>
      ) : name === 'arrow' ? (
        <path d="m9 5 7 7-7 7" />
      ) : name === 'translate' ? (
        <>
          <path d="M3 5h12M9 3v2m-4 3c1 4 4 6 8 8M12 5c0 5-4 9-8 11m9 5 4-10 4 10m-6-4h4" />
        </>
      ) : (
        <path d="M12 5v14M5 12h14" />
      )}
    </svg>
  );
}

export function VocabularySpeak({
  term,
  speech,
}: {
  term: string;
  speech: ReturnType<typeof useVocabularySpeech>;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru',
    active = speech.playing === term;
  return (
    <button
      type="button"
      className="vc-speak"
      aria-pressed={active}
      aria-label={`${active ? (ru ? 'Остановить' : 'Stop') : ru ? 'Произнести' : 'Pronounce'} ${term}`}
      onClick={() => speech.speak(term)}
    >
      <VocabularyIcon name="speaker" />
    </button>
  );
}
