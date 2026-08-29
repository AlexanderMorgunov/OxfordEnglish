import { useEffect, useRef, useState } from 'react';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { Button, Console, Input, SegmentedToggle } from '@/shared/ui';
import { cn } from '@/shared/lib/cn';
import { ExerciseView } from '@/features/practice/exercises/ExerciseView';
import { useUiLang } from '@/features/i18n/uiLang';
import { exLabels } from '@/features/i18n/ui-strings';
import { activeCueIndex, diffWords, dictationCorrect } from './cues';

type ListeningSection = Extract<Section, { type: 'listening' }>;
type Cue = NonNullable<ListeningSection['transcript']>[number];

const RATES = { '0.75': 0.75, '1': 1, '1.25': 1.25 } as const;
type RateKey = keyof typeof RATES;

function DictationRow({
  cue,
  onPlay,
}: {
  cue: Cue;
  onPlay: () => void;
}) {
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const [value, setValue] = useState('');
  const [checked, setChecked] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const parts = checked ? diffWords(cue.en, value) : [];
  const correct = checked && dictationCorrect(cue.en, value);

  return (
    <div className="card-exercise">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <Button size="sm" variant="ghost" onClick={onPlay}>
          {ru ? '▶ фраза' : '▶ play phrase'}
        </Button>
        <span className="font-mono text-2xs text-muted">
          {ru ? 'наберите, что слышите' : 'type what you hear'}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => setRevealed(true)}
        >
          {ru ? 'показать ответ' : 'show answer'}
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <Input
          className="min-w-64 flex-1"
          placeholder={ru ? 'наберите фразу…' : 'type the phrase…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value.trim() && setChecked(true)}
        />
        <Button onClick={() => value.trim() && setChecked(true)}>{exLabels(lang).runCheck}</Button>
      </div>
      {revealed && (
        <p className="mt-3 text-base text-content">
          <span className="mr-1.5 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            {ru ? 'ответ' : 'answer'}
          </span>
          {cue.en}
        </p>
      )}
      {checked && (
        <Console status={correct ? 'pass' : 'fail'}>
          {correct ? '✓ ' : '✕ '}
          {parts.map((p, i) => (
            <span key={i} className={p.ok ? 'text-teal' : 'text-coral line-through'}>
              {p.text}{' '}
            </span>
          ))}
        </Console>
      )}
    </div>
  );
}

export function ListeningSectionView({ section }: { section: ListeningSection }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const audioRef = useRef<HTMLAudioElement>(null);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [rate, setRate] = useState<RateKey>('1');
  const [showTranscript, setShowTranscript] = useState(false);
  const [dictation, setDictation] = useState(false);
  const loop = useRef<{ a: number; b: number | null; once: boolean }>({ a: 0, b: null, once: false });
  const rafId = useRef<number | null>(null);
  const cues = section.transcript ?? [];
  const active = activeCueIndex(time, cues);

  const audio = () => audioRef.current;
  const seek = (t: number) => {
    const el = audio();
    if (el) el.currentTime = t;
  };
  // Stop/loop a bounded segment exactly at `b`. Read `loop.current` fresh (the A-B buttons mutate it
  // and the segment plays via the main play button, not playFrom). `b > a` guards against a reversed
  // A-B range turning into a per-frame seek storm.
  const checkBoundary = (el: HTMLAudioElement) => {
    const { a, b, once } = loop.current;
    if (b === null || el.currentTime < b) return;
    if (once) {
      el.pause();
      loop.current = { a: 0, b: null, once: false };
    } else if (b > a) {
      el.currentTime = a;
    }
  };
  const stopWatch = () => {
    if (rafId.current !== null) {
      cancelAnimationFrame(rafId.current);
      rafId.current = null;
    }
  };
  // rAF (~16 ms) is the precise stop; the onTimeUpdate check (~250 ms) is a backstop for a hidden tab,
  // where rAF is suspended but timeupdate keeps firing. Self-terminates on paused/ended (a natural end
  // fires `ended`, not `pause`).
  const startWatch = () => {
    if (rafId.current !== null) return;
    const tick = () => {
      const el = audio();
      if (!el || el.paused || el.ended) {
        rafId.current = null;
        return;
      }
      checkBoundary(el);
      rafId.current = requestAnimationFrame(tick);
    };
    rafId.current = requestAnimationFrame(tick);
  };
  useEffect(() => stopWatch, []);

  const playFrom = (start: number, end?: number, once = false) => {
    const el = audio();
    if (!el) return;
    el.currentTime = start;
    loop.current = { a: start, b: end ?? null, once };
    void el.play();
    startWatch();
  };
  const setRateKey = (k: RateKey) => {
    setRate(k);
    const el = audio();
    if (el) el.playbackRate = RATES[k];
  };

  return (
    <div className="flex flex-col gap-4">
      <audio
        ref={audioRef}
        src={packMediaUrl(section.audio.src)}
        preload="metadata"
        onPlay={() => {
          setPlaying(true);
          setHasPlayed(true);
          startWatch();
        }}
        onPause={() => {
          setPlaying(false);
          stopWatch();
        }}
        onEnded={() => {
          setPlaying(false);
          stopWatch();
        }}
        onTimeUpdate={(e) => {
          setTime(e.currentTarget.currentTime);
          checkBoundary(e.currentTarget);
        }}
      />

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface p-4">
        <Button
          onClick={() => {
            const el = audio();
            if (!el) return;
            if (playing) el.pause();
            else void el.play();
          }}
        >
          {playing ? (ru ? '❚❚ пауза' : '❚❚ pause') : ru ? '▶ слушать' : '▶ play'}
        </Button>
        <SegmentedToggle
          ariaLabel={ru ? 'Скорость воспроизведения' : 'Playback speed'}
          value={rate}
          onChange={setRateKey}
          segments={[
            { value: '0.75', label: '0.75×' },
            { value: '1', label: '1×' },
            { value: '1.25', label: '1.25×' },
          ]}
        />
        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (loop.current = { a: time, b: loop.current.b, once: false })}
          >
            A: {time.toFixed(1)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (loop.current = { a: loop.current.a, b: time, once: false })}
          >
            B
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (loop.current = { a: 0, b: null, once: false })}
          >
            {ru ? 'сбросить петлю' : 'clear loop'}
          </Button>
        </div>
      </div>

      {!hasPlayed ? (
        <p className="font-mono text-2xs text-muted">
          {ru
            ? 'сначала послушайте — расшифровка откроется после первого воспроизведения.'
            : 'listen first — the transcript unlocks after you play once.'}
        </p>
      ) : (
        <div className="flex gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setShowTranscript((v) => !v)}
          >
            {showTranscript
              ? ru
                ? 'скрыть расшифровку'
                : 'hide transcript'
              : ru
                ? 'показать расшифровку'
                : 'show transcript'}
          </Button>
          {cues.length > 0 && (
            <Button
              size="sm"
              variant={dictation ? 'primary' : 'ghost'}
              onClick={() => setDictation((v) => !v)}
            >
              {ru ? 'диктант' : 'dictation'}
            </Button>
          )}
        </div>
      )}

      {showTranscript && cues.length > 0 && !dictation && (
        <ul className="flex flex-col gap-1.5 rounded-lg border border-line bg-surface p-4">
          {cues.map((cue, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => seek(cue.start)}
                className={cn(
                  'w-full rounded-sm px-2 py-1 text-left text-base transition-colors',
                  i === active ? 'bg-surface-2 text-teal' : 'text-content hover:bg-surface-2'
                )}
              >
                {cue.en}
                {cue.ru && <span className="ml-2 text-muted">— {cue.ru}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {dictation && cues.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {cues.map((cue, i) => (
            <DictationRow key={i} cue={cue} onPlay={() => playFrom(cue.start, cue.end, true)} />
          ))}
        </div>
      )}

      {section.exercises.length > 0 && (
        <div className="flex flex-col gap-3.5">
          {section.exercises.map((exercise) => (
            <ExerciseView key={exercise.id} exercise={exercise} />
          ))}
        </div>
      )}
    </div>
  );
}
