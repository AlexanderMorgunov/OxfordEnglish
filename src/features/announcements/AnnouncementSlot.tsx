import { useState, useSyncExternalStore } from 'react';
import { useUiLang } from '@/features/i18n/uiLang';
import { AnnouncementCard } from './AnnouncementCard';
import type { Announcement } from './model';
import { useAnnouncementOwner, useAnnouncements } from './model';
import {
  announcementSeen,
  rememberAnnouncement,
  subscribeAnnouncementMemory,
} from './memory';

export function AnnouncementSlot({
  placement,
  onDismiss,
}: {
  placement: Announcement['placement'];
  onDismiss: () => void;
}) {
  const announcements = useAnnouncements();
  const owner = useAnnouncementOwner();
  const ru = useUiLang((state) => state.lang === 'ru');
  const release = useSyncExternalStore(subscribeAnnouncementMemory, () =>
    announcements.find(
      (entry) =>
        entry.placement === placement && !announcementSeen(owner, entry.id)
    )
  );
  const [message, setMessage] = useState<{ owner: string; text: string }>();
  const status = message?.owner === owner ? message.text : '';
  if (!release && !status) return null;

  return (
    <>
      {release && (
        <AnnouncementCard
          release={release}
          onDismiss={() => {
            onDismiss();
            rememberAnnouncement(owner, release.id);
            setMessage({
              owner,
              text: ru
                ? 'Анонс скрыт. Его можно найти в разделе «Что нового».'
                : 'Announcement dismissed. Find it again in What’s new.',
            });
          }}
        />
      )}
      <p className="sr-only" role="status">
        {status}
      </p>
    </>
  );
}
