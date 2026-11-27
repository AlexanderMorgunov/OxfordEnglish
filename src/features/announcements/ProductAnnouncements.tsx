import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { loadCatalog } from '@/features/games/api';
import {
  gameAccessAllowed,
  useGameAvailability,
} from '@/features/games/availability';
import { isLumiAvailable, lumiAnnouncement } from './lumi';
import { AnnouncementContext } from './model';
import type { Announcement } from './model';

const lumi = [lumiAnnouncement];
const empty: readonly Announcement[] = [];

export function ProductAnnouncements({ children }: { children: ReactNode }) {
  const allowed = useGameAvailability((state) => state.access === 'allowed');
  const epoch = useGameAvailability((state) => state.epoch);
  const [availableEpoch, setAvailableEpoch] = useState<number | null>(null);

  useEffect(() => {
    if (!allowed) return;
    let controller: AbortController | undefined;
    function checkCatalog() {
      if (document.visibilityState === 'hidden' || !gameAccessAllowed()) return;
      controller?.abort();
      const request = new AbortController();
      controller = request;
      void loadCatalog(request.signal).then(
        (games) => {
          if (!request.signal.aborted && gameAccessAllowed()) {
            setAvailableEpoch(games.some(isLumiAvailable) ? epoch : null);
          }
        },
        () => {
          if (!request.signal.aborted) setAvailableEpoch(null);
        }
      );
    }
    checkCatalog();
    window.addEventListener('online', checkCatalog);
    document.addEventListener('visibilitychange', checkCatalog);
    return () => {
      controller?.abort();
      window.removeEventListener('online', checkCatalog);
      document.removeEventListener('visibilitychange', checkCatalog);
    };
  }, [allowed, epoch]);

  return (
    <AnnouncementContext
      value={
        allowed && gameAccessAllowed() && availableEpoch === epoch
          ? lumi
          : empty
      }
    >
      {children}
    </AnnouncementContext>
  );
}
