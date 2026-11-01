import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { cancelSpeech, speakWord } from '@/shared/lib/audio';
import { subscribeDataScope } from '@/features/account/dataScope';

export function useVocabularySpeech() {
  const ru = useUiLang((s) => s.lang) === 'ru',
    available = useSpeechAvailable(),
    location = useLocation();
  const [playing, setPlaying] = useState<string | null>(null),
    [error, setError] = useState('');
  const generation = useRef(0),
    owned = useRef(false),
    watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = useCallback(() => {
    generation.current++;
    if (watchdog.current) clearTimeout(watchdog.current);
    watchdog.current = null;
    if (owned.current) cancelSpeech();
    owned.current = false;
    setPlaying(null);
  }, []);
  useEffect(() => {
    const unsubscribe = subscribeDataScope(() => {
      stop();
      setError('');
    });
    return () => {
      unsubscribe();
      stop();
    };
  }, [stop]);
  useEffect(() => {
    stop();
    setError('');
  }, [location.key, available, stop]);
  const speak = (term: string) => {
    const was = playing === term;
    stop();
    setError('');
    if (was) return;
    if (!available) {
      setError(
        ru
          ? 'Английская озвучка недоступна. Проверьте голоса в настройках.'
          : 'English speech is unavailable. Check voices in Settings.'
      );
      return;
    }
    const id = generation.current;
    owned.current = true;
    setPlaying(term);
    const finish = (failed = false) => {
      if (generation.current !== id) return;
      owned.current = false;
      setPlaying(null);
      if (watchdog.current) clearTimeout(watchdog.current);
      if (failed)
        setError(
          ru
            ? 'Не удалось произнести слово. Проверьте английский голос и повторите.'
            : 'Could not pronounce the term. Check your English voice and retry.'
        );
    };
    watchdog.current = setTimeout(() => {
      if (generation.current !== id) return;
      cancelSpeech();
      finish(true);
    }, 30000);
    try {
      speakWord(term, { onEnd: () => finish(), onError: () => finish(true) });
    } catch {
      finish(true);
    }
  };
  return { playing, error, speak, stop };
}
