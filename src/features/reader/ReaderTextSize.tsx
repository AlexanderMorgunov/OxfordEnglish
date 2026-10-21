import { useUiLang } from '@/features/i18n/uiLang';
import { TextSizeControl } from '@/shared/ui/TextSizeControl';
import { DEFAULT_FONT_STEP, FONT_SIZES, useReaderSettings } from './settings';
import { keepReadingAnchor } from './reading-anchor';

export function ReaderTextSize() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const fontStep = useReaderSettings(s => s.fontStep);
  const setFontStep = useReaderSettings(s => s.setFontStep);
  const percentage = Math.round((FONT_SIZES[fontStep] ?? FONT_SIZES[DEFAULT_FONT_STEP]) / FONT_SIZES[DEFAULT_FONT_STEP] * 100);

  const change = (step: number) => keepReadingAnchor(() => setFontStep(step));
  return <TextSizeControl label={ru ? 'Размер текста книги' : 'Book text size'} step={fontStep} max={FONT_SIZES.length - 1} value={`${percentage}%`}
    onChange={change} onReset={() => change(DEFAULT_FONT_STEP)} />;
}
