import { useUiLang } from '@/features/i18n/uiLang';
import { Button, Card } from '@/shared/ui';
import { useContentStore } from '@/content/store';

export function ContentLoadError() {
  const ru = useUiLang((s) => s.lang) === 'ru';
  const load = useContentStore((s) => s.load);
  return (
    <Card className="border-coral">
      <div role="alert">
        <p className="font-mono text-sm text-coral">
          {ru ? 'Не удалось загрузить курс' : 'The course could not be loaded'}
        </p>
        <p className="mt-2 text-sm text-muted">
          {ru
            ? 'Проверьте подключение к интернету и попробуйте ещё раз. Ваш прогресс сохранён на устройстве.'
            : 'Check your internet connection and try again. Your progress is saved on this device.'}
        </p>
      </div>
      <Button className="mt-4" onClick={() => void load()}>
        {ru ? 'Повторить загрузку' : 'Retry loading'}
      </Button>
    </Card>
  );
}
