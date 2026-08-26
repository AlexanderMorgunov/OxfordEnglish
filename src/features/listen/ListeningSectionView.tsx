import { useRef, useState } from 'react';
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
  const parts = checked ? diffWords(cue.en, value) : [];
  const correct = checked && dictationCorrect(cue.en, value);

  return (
    <div className="card-exercise">
      <div className="mb-3 flex items-center gap-2.5">
        <Button size="sm" variant="ghost" onClick={onPlay}>
          {ru ? '▶ фраза' : '▶ play phrase'}
        </Button>
        <span className="font-mono text-2xs text-muted">
          {ru ? 'наберите, что слышите' : 'type what you hear'}
        </span>
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
  const loop = useRef<{ a: number; b: number | null }>({ a: 0, b: null });
  const cues = section.transcript ?? [];
  const active = activeCueIndex(time, cues);

  const audio = () => audioRef.current;
  const seek = (t: number) => {
    const el = audio();
    if (el) el.currentTime = t;
  };
  const playFrom = (start: number, end?: number) => {
    const el = audio();
    if (!el) return;
    el.currentTime = start;
    loop.current = { a: start, b: end ?? null };
    void el.play();
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
        }}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => {
          const t = e.currentTarget.currentTime;
          setTime(t);
          const { a, b } = loop.current;
          if (b !== null && t >= b) e.currentTarget.currentTime = a;
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
            onClick={() => (loop.current = { a: time, b: loop.current.b })}
          >
            A: {time.toFixed(1)}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (loop.current = { a: loop.current.a, b: time })}
          >
            B
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => (loop.current = { a: 0, b: null })}
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
            <DictationRow key={i} cue={cue} onPlay={() => playFrom(cue.start, cue.end)} />
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
