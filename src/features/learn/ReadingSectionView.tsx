import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import type { Section } from '@/content/schema';
import { packMediaUrl } from '@/content/loader';
import { PixelImage, PopoverGroup, SegmentedToggle } from '@/shared/ui';
import { useVocabStore } from '@/features/vocab/vocabStore';
import { resumeExclusive, speakWord } from '@/shared/lib/audio';
import { useSpeechAvailable } from '@/shared/lib/useSpeechAvailable';
import { addWordCard } from '@/features/srs/service';
import { ReadingText, type Gloss } from '@/features/reader/reading-text';
import { useUiLang } from '@/features/i18n/uiLang';
import { exLabels } from '@/features/i18n/ui-strings';
import { getDataScopeRevision, subscribeDataScope } from '@/features/account/dataScope';
import { consumeLessonWordReturn, currentWordReturn, discardWordReturn, lessonWordKey, useWordReturn } from '@/features/reader/word-return';

type ReadingSection = Extract<Section, { type: 'reading' }>;

function GlossaryRow({ word, ipa, ru: glossRu }: { word: string; ipa?: string; ru?: string }) {
  const canSpeak = useSpeechAvailable();
  const lang = useUiLang((s) => s.lang);
  const ru = lang === 'ru';
  const L = exLabels(lang);
  const [saved, setSaved] = useState(false);
  return (
    <div className="flex flex-wrap items-baseline gap-2">
      <dt className="font-mono text-sm text-content">{word}</dt>
      {canSpeak && (
        <button
          type="button"
          aria-label={ru ? `Произнести ${word}` : `Pronounce ${word}`}
          className="text-teal transition-opacity hover:opacity-80"
          onClick={() => speakWord(word)}
        >
          🔊
        </button>
      )}
      {ipa && <span className="font-mono text-xs text-muted">{ipa}</span>}
      {glossRu && <dd className="text-sm text-muted">— {glossRu}</dd>}
      <button
        type="button"
        disabled={saved}
        className="ml-auto font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline disabled:text-faint disabled:no-underline"
        onClick={() => {
          void addWordCard(word, glossRu ?? word, undefined);
          setSaved(true);
        }}
      >
        {saved ? L.inReview : L.addReview}
      </button>
    </div>
  );
}

function ReadingBlock({
  en,
  ru: blockRu,
  audioUrl,
  imageUrl,
  imageAlt,
  rate,
  glossary,
  sectionId,
  blockId,
}: {
  en: string;
  ru?: string;
  audioUrl?: string;
  imageUrl?: string;
  imageAlt?: string;
  rate: number;
  glossary: Map<string, Gloss>;
  sectionId: string;
  blockId: string;
}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [showRu, setShowRu] = useState(false);
  const paragraphs = useMemo(() => [en], [en]);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const el = audioRef.current;
    if (el) el.playbackRate = rate;
  }, [rate]);

  return (
    <div className="border-b border-line pb-4 last:border-b-0">
      {imageUrl && (
        <PixelImage
          src={imageUrl}
          alt={imageAlt ?? ''}
          className="mb-3 w-full rounded-md border border-line"
        />
      )}
      {audioUrl && (
        <audio
          ref={audioRef}
          src={audioUrl}
          preload="none"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      )}
      <ReadingText paragraphs={paragraphs} glossary={glossary} lesson={{ sectionId, blockIds: [blockId], recording: audioUrl ? (
          <button
            type="button"
            aria-label={
              playing
                ? ru
                  ? 'Пауза'
                  : 'Pause'
                : ru
                  ? 'Прослушать абзац'
                  : 'Play paragraph'
            }
            className="mr-1.5 align-middle text-teal transition-opacity hover:opacity-80"
            onClick={() => {
              const el = audioRef.current;
              if (!el) return;
              if (playing) el.pause();
              else resumeExclusive(el, rate);
            }}
          >
            {playing ? '❚❚' : '▶'}
          </button>
      ) : null }} />
      {blockRu && (
        <div className="mt-2">
          {showRu ? (
            <p className="text-base text-muted text-pretty">{blockRu}</p>
          ) : (
            <button
              type="button"
              className="font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
              onClick={() => setShowRu(true)}
            >
              {ru ? 'показать перевод' : 'show translation'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const READING_RATES = { '0.75': 0.75, '1': 1, '1.25': 1.25 } as const;
type ReadingRateKey = keyof typeof READING_RATES;

export function ReadingSectionView({ section }: { section: ReadingSection }) {
  const revision = useSyncExternalStore(subscribeDataScope, getDataScopeRevision);
  return <PopoverGroup key={`${section.id}:${revision}`}><ReadingSession section={section} /></PopoverGroup>;
}

function ReadingSession({ section }: { section: ReadingSection }) {
  const canSpeak = useSpeechAvailable();
  const load = useVocabStore((s) => s.load);
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [rateKey, setRateKey] = useState<ReadingRateKey>('0.75');
  const textRef = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const wordReturn = useWordReturn(s => s.entry);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const entry = currentWordReturn();
    if (entry?.kind !== 'lesson' || entry.phase !== 'ready' || entry.pathname !== pathname || entry.sectionId !== section.id) return;
    const frame = requestAnimationFrame(() => {
      if (currentWordReturn()?.id !== entry.id) return;
      const token = [...(textRef.current?.querySelectorAll<HTMLButtonElement>('[data-lesson-word]') ?? [])]
        .find(el => el.dataset.lessonWord === lessonWordKey(entry) && el.textContent === entry.word);
      if (!token) { discardWordReturn(); return; }
      token.scrollIntoView({ block: 'center' });
      if (token.getAttribute('aria-expanded') === 'true') consumeLessonWordReturn(entry, entry.word);
      else token.click();
      document.getElementById(token.getAttribute('aria-controls') ?? '')?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [wordReturn, pathname, section.id]);

  const rate = READING_RATES[rateKey];

  const glossary = useMemo(
    () => new Map(section.glossary.map((g) => [g.word.toLowerCase(), { ru: g.ru, ipa: g.ipa }])),
    [section.glossary]
  );
  const hasAudio = section.blocks.some((b) => b.audio);

  return (
    <div className="flex flex-col gap-4">
      {section.image && (
        <PixelImage
          src={packMediaUrl(section.image.src)}
          alt={section.image.alt?.en ?? section.title.en}
          className="w-full rounded-md border border-line"
        />
      )}

      {hasAudio && canSpeak && (
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            {ru ? 'скорость аудио' : 'audio speed'}
          </span>
          <SegmentedToggle
            ariaLabel={ru ? 'Скорость чтения вслух' : 'Reading audio speed'}
            value={rateKey}
            onChange={setRateKey}
            segments={[
              { value: '0.75', label: '0.75×' },
              { value: '1', label: '1×' },
              { value: '1.25', label: '1.25×' },
            ]}
          />
        </div>
      )}

      <div
        ref={textRef}
        className="flex flex-col gap-4"
      >
        {section.blocks.map((block) => (
          <ReadingBlock
            key={block.id}
            sectionId={section.id}
            blockId={block.id}
            en={block.en}
            ru={block.ru}
            audioUrl={block.audio ? packMediaUrl(block.audio.src) : undefined}
            imageUrl={block.image ? packMediaUrl(block.image.src) : undefined}
            imageAlt={block.image?.alt?.en ?? ''}
            rate={rate}
            glossary={glossary}
          />
        ))}
      </div>

      {section.attribution && (
        <p className="font-mono text-2xs text-faint">
          {ru ? 'источник' : 'source'}: {section.attribution}
        </p>
      )}

      {section.glossary.length > 0 && (
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="mb-3 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            {ru ? 'глоссарий' : 'glossary'}
          </p>
          <dl className="flex flex-col gap-2">
            {section.glossary.map((g) => (
              <GlossaryRow key={g.word} word={g.word} ipa={g.ipa} ru={g.ru} />
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
