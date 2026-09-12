import { useNavigate, useSearchParams } from 'react-router-dom';
import { useUiLang } from '@/features/i18n/uiLang';
import { readerReturnPath } from './return-to-reader';

/**
 * "Back to reading" for pages opened from the reader widget. Shown only when the link carried
 * `?from=reader`, so it never appears for someone who came through the normal nav. Navigates to the
 * remembered book page when there is one; history is the fallback.
 */
export function BackToReader({ className }: { className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const navigate = useNavigate();
  const fromReader = useSearchParams()[0].get('from') === 'reader';
  if (!fromReader) return null;

  const back = () => {
    const path = readerReturnPath();
    if (path) navigate(path);
    else navigate(-1);
  };

  return (
    <button
      type="button"
      onClick={back}
      className={
        className ??
        'mb-3.5 font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal'
      }
    >
      ← {ru ? 'назад к чтению' : 'back to reading'}
    </button>
  );
}
