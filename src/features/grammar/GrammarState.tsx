import { Button } from '@/shared/ui';
import { useGrammarStore } from '@/content/grammarStore';
import { useUiLang } from '@/features/i18n/uiLang';

export function GrammarState() {
  const { status, load, cancel } = useGrammarStore();
  const ru = useUiLang((s) => s.lang) === 'ru';
  const loading = status === 'idle' || status === 'loading';
  return (
    <div className="grammar-empty" role="status">
      <span aria-hidden="true" className="grammar-empty-symbol">
        Aa
      </span>
      <h2>
        {loading
          ? ru
            ? 'Загружаем справочник…'
            : 'Loading the reference…'
          : status === 'cancelled'
            ? ru
              ? 'Загрузка отменена'
              : 'Loading cancelled'
            : ru
              ? 'Справочник не загрузился'
              : 'The reference did not load'}
      </h2>
      <p>
        {loading
          ? ru
            ? 'Запрос и фильтры останутся на месте.'
            : 'Your search and filters will stay in place.'
          : ru
            ? 'Проверьте соединение и повторите попытку.'
            : 'Check your connection and retry.'}
      </p>
      <Button onClick={loading ? cancel : () => void load()}>
        {loading
          ? ru
            ? 'Отменить загрузку'
            : 'Cancel loading'
          : ru
            ? 'Повторить загрузку'
            : 'Retry loading'}
      </Button>
    </div>
  );
}
