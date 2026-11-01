import { useUiLang } from '@/features/i18n/uiLang';
import { TextSizeControl } from '@/shared/ui/TextSizeControl';
import { DEFAULT_FONT_STEP, FONT_SIZES, useReaderSettings } from './settings';
import { keepReadingAnchor } from './reading-anchor';

export function ReaderTextSize({
  step,
  onChange,
  defaultStep = DEFAULT_FONT_STEP,
  display = 'percent',
}: {
  step?: number;
  onChange?: (step: number) => void;
  defaultStep?: number;
  display?: 'percent' | 'pixels';
} = {}) {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const savedFontStep = useReaderSettings((s) => s.fontStep);
  const fontStep = step ?? savedFontStep;
  const setFontStep = useReaderSettings((s) => s.setFontStep);
  const percentage = Math.round(
    ((FONT_SIZES[fontStep] ?? FONT_SIZES[DEFAULT_FONT_STEP]) /
      (FONT_SIZES[defaultStep] ?? FONT_SIZES[DEFAULT_FONT_STEP])) *
      100
  );

  const change = (step: number) =>
    keepReadingAnchor(() => (onChange ?? setFontStep)(step));
  return (
    <TextSizeControl
      label={ru ? 'Размер текста книги' : 'Book text size'}
      step={fontStep}
      max={FONT_SIZES.length - 1}
      value={
        display === 'pixels'
          ? `${FONT_SIZES[fontStep] ?? FONT_SIZES[defaultStep]} px`
          : `${percentage}%`
      }
      onChange={change}
      onReset={() => change(defaultStep)}
    />
  );
}
