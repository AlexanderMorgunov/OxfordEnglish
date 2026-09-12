import { useState } from 'react';
import { cn } from '@/shared/lib/cn';
import { useUiLang } from '@/features/i18n/uiLang';
import { CefrChip } from '@/features/vocab/CefrChip';
import { FormsLine } from '@/features/vocab/FormsLine';
import { irregularForms } from '@/features/vocab/irregular';

const SENTENCE = 'Alice was curious, so she followed the Rabbit and went down the hole.';

/** CEFR level index (A1=0 … B2=3) and the gloss the reader would show for the tappable words. */
const WORDS: Record<string, { ru: string; en: string; level: number | null }> = {
  curious: { ru: 'любопытный', en: 'eager to know', level: 2 },
  followed: { ru: 'пошла за, последовала', en: 'went after', level: 1 },
  went: { ru: 'пошла, отправилась', en: 'past of “go”', level: 0 },
};

/** The reader's word lookup, played out on the landing with the real chip and forms components. */
export function WordTapDemo() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [picked, setPicked] = useState<string | null>(null);
  const entry = picked ? WORDS[picked] : null;

  return (
    <div className="rounded-lg border border-line bg-surface p-4">
      <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
        {ru ? 'страница книги — нажмите подчёркнутое слово' : 'a book page — tap an underlined word'}
      </p>
      <p className="text-lg leading-relaxed text-content">
        {SENTENCE.split(/(\s+)/).map((chunk, i) => {
          const key = chunk.replace(/[^A-Za-z]/g, '').toLowerCase();
          if (!WORDS[key]) return <span key={i}>{chunk}</span>;
          return (
            <button
              key={i}
              type="button"
              aria-pressed={picked === key}
              onClick={() => setPicked(picked === key ? null : key)}
              className={cn(
                'cursor-pointer rounded-[2px] underline decoration-2 underline-offset-4 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal',
                picked === key
                  ? 'bg-surface-2 text-teal [text-decoration-color:var(--color-teal)]'
                  : '[text-decoration-color:var(--color-word-unknown)] hover:bg-surface-2'
              )}
            >
              {chunk}
            </button>
          );
        })}
      </p>

      <div aria-live="polite" className="mt-3">
        {entry && picked ? (
          <div className="rounded-md border border-teal-dim bg-ink p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-content">{picked}</span>
              <span aria-hidden className="text-teal">
                🔊
              </span>
              <CefrChip level={entry.level} />
            </div>
            <p className="mt-1 text-sm text-content">{ru ? entry.ru : entry.en}</p>
            <FormsLine word={picked} forms={irregularForms(picked)} className="mt-1 font-mono text-2xs" />
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {[
                { ru: 'учу', en: 'learning' },
                { ru: 'знаю', en: 'known' },
              ].map((b) => (
                <span
                  key={b.en}
                  className="rounded-sm border border-line px-2 py-0.5 font-mono text-2xs text-muted"
                >
                  {ru ? b.ru : b.en}
                </span>
              ))}
              <span className="font-mono text-2xs text-muted">
                {ru ? '→ слово уходит в повторения' : '→ the word goes into review'}
              </span>
            </div>
          </div>
        ) : (
          <p className="font-mono text-2xs text-faint">
            {ru
              ? 'перевод, уровень слова и формы глагола — без выхода из книги'
              : 'translation, word level and verb forms — without leaving the book'}
          </p>
        )}
      </div>
    </div>
  );
}
