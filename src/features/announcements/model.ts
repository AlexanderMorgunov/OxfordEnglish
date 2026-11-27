import { createContext, use, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import type { LocalizedText } from '@/content/schema';
import { useAccount } from '@/features/account/store';
import { rememberAnnouncement } from './memory';

export type Announcement = {
  id: string;
  placement: 'today' | 'library' | 'review';
  title: LocalizedText;
  description: LocalizedText;
  action: LocalizedText;
  to: string;
  artwork?: string;
};

export const AnnouncementContext = createContext<readonly Announcement[]>([]);

export function useAnnouncements() {
  return use(AnnouncementContext);
}

export function useAnnouncementOwner() {
  const accountId = useAccount((state) => state.accountId);
  return accountId ? `account:${encodeURIComponent(accountId)}` : 'guest';
}

export function useAnnouncementNavigation(id: string) {
  const owner = useAnnouncementOwner();
  const sessionRevision = useAccount((state) => state.sessionRevision);
  return { announcement: { id, owner, sessionRevision } };
}

export function useCompleteAnnouncementVisit(
  release: Announcement,
  ready: boolean
) {
  const { pathname, state } = useLocation();
  const { announcement } = useAnnouncementNavigation(release.id);
  const { id, owner, sessionRevision } = announcement;
  const visit: unknown = state?.announcement;
  const arrived =
    pathname === release.to &&
    !!visit &&
    typeof visit === 'object' &&
    'id' in visit &&
    visit.id === id &&
    'owner' in visit &&
    visit.owner === owner &&
    'sessionRevision' in visit &&
    visit.sessionRevision === sessionRevision;
  useEffect(() => {
    if (ready && arrived) rememberAnnouncement(owner, id);
  }, [arrived, id, owner, ready]);
  return arrived;
}
