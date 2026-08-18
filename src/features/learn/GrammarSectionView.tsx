import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Section } from '@/content/schema';
import { SegmentedToggle } from '@/shared/ui';
import { useUiLang } from '@/features/i18n/uiLang';

type Props = { section: Extract<Section, { type: 'grammar' }> };

export function GrammarSectionView({ section }: Props) {
  const [lang, setLang] = useState<'en' | 'ru'>('en');
  const uiLang = useUiLang((s) => s.lang);
  const hasRu = Boolean(section.rule.ru);
  const showRu = lang === 'ru' && hasRu;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-line bg-surface p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="font-mono text-2xs uppercase tracking-[0.08em] text-muted">
            rule
          </span>
          {hasRu && (
            <SegmentedToggle
              ariaLabel="Rule language"
              value={lang}
              onChange={setLang}
              segments={[
                { value: 'en', label: 'en' },
                { value: 'ru', label: 'ru' },
              ]}
            />
          )}
        </div>
        <p className="text-lg leading-relaxed text-pretty">
          {showRu ? section.rule.ru : section.rule.en}
        </p>
      </div>

      <div className="overflow-hidden rounded-lg border border-line bg-surface">
        {section.patterns.map((pattern, i) => (
          <div key={i} className="border-b border-line p-5 last:border-b-0">
            <p className="mb-2 font-mono text-2xs uppercase tracking-[0.08em] text-muted">
              {showRu ? pattern.label.ru ?? pattern.label.en : pattern.label.en}
            </p>
            <p className="font-mono text-sm text-amber">{pattern.formula}</p>
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {pattern.examples.map((ex, j) => (
                <li key={j} className="text-base text-muted">
                  <span className="text-content">{ex.en}</span>
                  {showRu && ex.ru && <span className="ml-2 text-muted">— {ex.ru}</span>}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {section.pitfalls && section.pitfalls.length > 0 && (
        <div className="rounded-lg border border-amber-dim bg-amber-dim/20 p-5">
          <p className="mb-2.5 font-mono text-2xs uppercase tracking-[0.08em] text-amber">
            common pitfalls
          </p>
          <ul className="flex flex-col gap-2">
            {section.pitfalls.map((pitfall, i) => (
              <li key={i} className="text-base leading-relaxed text-pretty">
                {showRu ? pitfall.ru ?? pitfall.en : pitfall.en}
              </li>
            ))}
          </ul>
        </div>
      )}

      {section.ref && (
        <Link
          to={`/grammar/${section.ref}`}
          className="self-start font-mono text-2xs uppercase tracking-[0.08em] text-teal hover:underline"
        >
          {uiLang === 'ru' ? '→ подробнее в справочнике' : '→ read more in the reference'}
        </Link>
      )}
    </div>
  );
}
