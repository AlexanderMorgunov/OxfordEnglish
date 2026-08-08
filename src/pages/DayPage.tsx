import { useParams } from 'react-router-dom';
import { PageStub } from '@/shared/ui/PageStub';

export function DayPage() {
  const { unitId, dayId } = useParams();
  return (
    <PageStub eyebrow={`${unitId ?? '—'} · learning day`} title={dayId ?? 'Day'}>
      Section flow (grammar → reading → listening → practice) lands in M3–M5.
    </PageStub>
  );
}
