import { useEffect, useMemo, useState } from 'react';
import { Eyebrow } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';
import { loadCatalog, type CatalogEntry } from '@/features/reader/catalog';
import { REPO_URL } from '@/features/community/config';

const TECH: { name: string; use: string }[] = [
  { name: 'React 19 · TypeScript · Vite', use: 'app framework & build' },
  { name: 'Tailwind CSS v4', use: 'styling' },
  { name: 'Dexie (IndexedDB)', use: 'offline storage' },
  { name: 'ts-fsrs', use: 'spaced-repetition scheduling' },
  { name: 'Zod · Zustand', use: 'validation & state' },
  { name: 'pdf.js', use: 'PDF reading' },
  { name: 'driver.js', use: 'the first-run tour' },
  { name: 'Piper TTS', use: 'course audio (self-hosted, offline)' },
  { name: 'Space Grotesk · JetBrains Mono', use: 'fonts (self-hosted via Fontsource)' },
];

// all-contributors emoji key, generalized to this project's kinds of contribution.
const KEY: { emoji: string; en: string; ru: string }[] = [
  { emoji: '💻', en: 'code', ru: 'код' },
  { emoji: '✍️', en: 'content & exercises', ru: 'контент и упражнения' },
  { emoji: '🎧', en: 'audio', ru: 'аудио' },
  { emoji: '🌍', en: 'translation', ru: 'перевод' },
  { emoji: '🎨', en: 'design', ru: 'дизайн' },
  { emoji: '🐛', en: 'bug reports', ru: 'баг-репорты' },
  { emoji: '🤔', en: 'ideas', ru: 'идеи' },
];

type Contributor = { name: string; handle?: string; kinds: string[] };
const CONTRIBUTORS: Contributor[] = [
  { name: 'Alexander Morgunov', handle: 'AlexanderMorgunov', kinds: ['💻', '✍️', '🎨'] },
];

function attributions(books: CatalogEntry[], type: string): string[] {
  return [...new Set(books.filter((b) => b.license.type === type).map((b) => b.license.attribution))].sort();
}

export function CreditsPage() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const [books, setBooks] = useState<CatalogEntry[]>([]);
  useEffect(() => {
    void loadCatalog().then(setBooks);
  }, []);

  const ccby = useMemo(() => attributions(books, 'CC-BY'), [books]);
  const pd = useMemo(() => books.some((b) => b.license.type === 'public-domain'), [books]);

  return (
    <section aria-label={ru ? 'Благодарности' : 'Credits'} className="max-w-prose">
      <Eyebrow className="mb-3.5">{ru ? 'благодарности' : 'credits'}</Eyebrow>
      <h1 className="mb-3 text-2xl font-bold tracking-tight text-balance">
        {ru ? 'Благодарности и лицензии' : 'Credits & licenses'}
      </h1>
      <p className="mb-8 text-base leading-relaxed text-pretty text-muted">
        {ru
          ? 'Приложение бесплатное и с открытым исходным кодом. Оно стоит на труде многих людей — авторов свободного контента и мейнтейнеров open-source. '
          : 'This app is free and open source. It stands on the work of many people — authors of free content and open-source maintainers. '}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
          {ru ? 'Исходный код на GitHub →' : 'Source on GitHub →'}
        </a>
      </p>

      <h2 className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
        {ru ? 'контент' : 'content'}
      </h2>
      <ul className="mb-8 flex flex-col gap-1.5 text-sm text-pretty">
        <li>
          {ru ? 'Курс и упражнения' : 'Course & exercises'} —{' '}
          <span className="text-muted">{ru ? 'авторы проекта (оригинал)' : 'project authors (original)'}</span>
        </li>
        {pd && (
          <li>
            {ru ? 'Классика из ' : 'Classics from '}
            <span className="text-muted">Project Gutenberg ({ru ? 'общественное достояние' : 'public domain'})</span>
          </li>
        )}
        {ccby.length > 0 && (
          <li>
            {ru ? 'Книги по лицензии CC-BY:' : 'CC-BY books:'}
            <ul className="mt-1.5 flex flex-col gap-1 pl-4 text-muted">
              {ccby.map((a) => (
                <li key={a} className="list-disc text-xs">
                  {a}
                </li>
              ))}
            </ul>
          </li>
        )}
      </ul>

      <h2 className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
        {ru ? 'собрано на' : 'built with'}
      </h2>
      <ul className="mb-8 flex flex-col gap-1 text-sm">
        {TECH.map((t) => (
          <li key={t.name} className="flex flex-wrap items-baseline gap-x-2">
            <span>{t.name}</span>
            <span className="font-mono text-2xs text-muted">— {t.use}</span>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 font-mono text-2xs uppercase tracking-[0.14em] text-muted">
        {ru ? 'люди' : 'contributors'}
      </h2>
      <ul className="mb-4 flex flex-col gap-1.5 text-sm">
        {CONTRIBUTORS.map((c) => (
          <li key={c.name} className="flex flex-wrap items-baseline gap-2">
            {c.handle ? (
              <a
                href={`https://github.com/${c.handle}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal hover:underline"
              >
                {c.name}
              </a>
            ) : (
              <span>{c.name}</span>
            )}
            <span aria-hidden>{c.kinds.join(' ')}</span>
          </li>
        ))}
      </ul>
      <p className="mb-2 text-sm text-pretty text-muted">
        {ru
          ? 'Хочешь оказаться здесь? Вклад — это не только код: аудио, перевод, упражнения, баг-репорты и идеи тоже считаются.'
          : 'Want to be here? Contribution is not only code — audio, translation, exercises, bug reports and ideas all count.'}{' '}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-teal hover:underline">
          {ru ? 'как помочь →' : 'how to contribute →'}
        </a>
      </p>
      <p className="flex flex-wrap gap-x-3 gap-y-1 border-t border-line pt-4 font-mono text-2xs text-muted">
        {KEY.map((k) => (
          <span key={k.emoji}>
            {k.emoji} {ru ? k.ru : k.en}
          </span>
        ))}
      </p>
    </section>
  );
}
