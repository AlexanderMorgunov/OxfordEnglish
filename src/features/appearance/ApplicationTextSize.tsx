import { useUiLang } from '@/features/i18n/uiLang';
import { TextSizeControl } from '@/shared/ui/TextSizeControl';
import { DEFAULT_UI_TEXT_STEP, UI_TEXT_SIZES, useAppearance } from './store';

export function ApplicationTextSize() {
  const ru = useUiLang(s => s.lang) === 'ru';
  const step = useAppearance(s => s.textStep);
  const setStep = useAppearance(s => s.setTextStep);
  return <section className="mb-8 border-b border-line pb-6">
    <TextSizeControl label={ru ? 'Размер текста приложения' : 'Application text size'} step={step} max={UI_TEXT_SIZES.length - 1}
      value={`${UI_TEXT_SIZES[step]}%`} onChange={setStep} onReset={() => setStep(DEFAULT_UI_TEXT_STEP)} />
    <p className="text-sm text-muted">{ru ? 'Интерфейс и задания. Размер текста книги меняется в настройках чтения.' : 'Interface and exercises. Adjust book text in the reader settings.'}</p>
    <p className="mt-3 text-base text-content">{ru ? 'Читайте и учитесь в удобном для вас размере.' : 'Read and learn at a comfortable text size.'}</p>
  </section>;
}
