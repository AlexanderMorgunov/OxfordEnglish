import { Fragment } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import type { Forms } from './irregular';

/** «формы: go — went — gone», one line per form set; the looked-up form is highlighted when it
 *  isn't the set's own base (so "went" lights up inside go's line). */
export function FormsLine({ word, forms, className }: { word: string; forms: Forms[]; className?: string }) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  if (!forms.length) return null;
  const w = word.toLowerCase();
  return (
    <div className={className}>
      {forms.map((f) => (
        <p key={`${f.kind}:${f.parts.join()}`}>
          <span className="text-muted">{ru ? 'формы' : 'forms'}: </span>
          {f.parts.map((variants, i) => (
            <Fragment key={i}>
              {i > 0 && <span className="text-muted"> — </span>}
              {variants.map((v, j) => (
                <Fragment key={v}>
                  {j > 0 && <span className="text-muted">/</span>}
                  <span className={v === w && w !== f.base ? 'text-teal' : 'text-content'}>{v}</span>
                </Fragment>
              ))}
            </Fragment>
          ))}
          {f.sense && <span className="text-muted"> ({ru ? f.sense.ru : f.sense.en})</span>}
        </p>
      ))}
    </div>
  );
}
