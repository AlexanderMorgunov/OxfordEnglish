import type { ProgressResource } from './useProgressResource';

export function ProgressStatus({
  resource,
  label,
  ru,
}: {
  resource: Pick<ProgressResource<unknown>, 'status' | 'retry' | 'cancel'>;
  label: string;
  ru: boolean;
}) {
  const loading = resource.status === 'loading';
  return (
    <div
      className="pr-unavailable"
      role={resource.status === 'error' ? 'alert' : 'status'}
    >
      <h3>
        {loading
          ? ru
            ? `Загружаем: ${label}`
            : `Loading: ${label}`
          : resource.status === 'cancelled'
            ? ru
              ? `Загрузка отменена: ${label}`
              : `Loading cancelled: ${label}`
            : ru
              ? `Не удалось загрузить: ${label}`
              : `Could not load: ${label}`}
      </h3>
      {!loading && (
        <p>
          {ru
            ? 'Данные не удалены. Остальные доступные показатели можно посмотреть отдельно.'
            : 'Your data has not been deleted. Other available figures can be viewed separately.'}
        </p>
      )}
      <button
        type="button"
        className="pr-button"
        onClick={loading ? resource.cancel : resource.retry}
      >
        {loading
          ? ru
            ? 'Отменить загрузку'
            : 'Cancel loading'
          : ru
            ? 'Повторить загрузку'
            : 'Retry loading'}
      </button>
    </div>
  );
}
