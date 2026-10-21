import { useId } from 'react';
import { Button } from '@/shared/ui/Button';
import { useUiLang } from '@/features/i18n/uiLang';

export function TextSizeControl({ label, step, max, value, onChange, onReset }: {
  label: string;
  step: number;
  max: number;
  value: string;
  onChange: (step: number) => void;
  onReset: () => void;
}) {
  const ru = useUiLang(s => s.lang) === 'ru';
  const id = useId();
  return <div role="group" aria-label={label} className="@container min-w-0">
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <label htmlFor={id} className="text-sm font-semibold text-content">{label}</label>
      <output htmlFor={id} role="status" aria-atomic="true" className="text-xs tabular-nums text-muted">{value}</output>
    </div>
    <div className="flex items-center gap-2 @max-[14rem]:flex-wrap @max-[14rem]:justify-between">
      <Button variant="ghost" className="min-h-11 min-w-11 px-2" aria-label={ru ? 'Меньше' : 'Smaller'} disabled={step <= 0} onClick={() => onChange(step - 1)}>A−</Button>
      <input id={id} type="range" min={0} max={max} step={1} value={step} aria-valuetext={value}
        className="min-h-11 min-w-0 flex-1 cursor-pointer accent-teal @max-[14rem]:order-first @max-[14rem]:basis-full" onChange={e => onChange(Number(e.target.value))} />
      <Button variant="ghost" className="min-h-11 min-w-11 px-2" aria-label={ru ? 'Больше' : 'Larger'} disabled={step >= max} onClick={() => onChange(step + 1)}>A+</Button>
    </div>
    <button type="button" onClick={onReset} className="min-h-11 text-sm text-teal underline underline-offset-4">{ru ? 'По умолчанию' : 'Reset to default'}</button>
  </div>;
}
