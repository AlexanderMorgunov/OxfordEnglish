import { useId } from 'react';
import { Link } from 'react-router-dom';
import { tr, useUiLang } from '@/features/i18n/uiLang';
import { AppIcon } from '@/shared/ui/AppIcon';
import { useAnnouncementNavigation } from './model';
import type { Announcement } from './model';
import './announcements.css';

export function AnnouncementAction({ release }: { release: Announcement }) {
  const lang = useUiLang((state) => state.lang);
  const navigation = useAnnouncementNavigation(release.id);
  return (
    <Link className="release-action" to={release.to} state={navigation}>
      {tr(release.action, lang)}
    </Link>
  );
}

export function AnnouncementCard({
  release,
  onDismiss,
}: {
  release: Announcement;
  onDismiss: () => void;
}) {
  const lang = useUiLang((state) => state.lang);
  const title = tr(release.title, lang);
  const titleId = useId();
  return (
    <article className="release-card" aria-labelledby={titleId}>
      {release.artwork && (
        <div className="release-art">
          <img src={release.artwork} alt="" />
        </div>
      )}
      <div className="release-copy">
        <p className="release-label">
          {lang === 'ru' ? 'Новое в DayEnglish' : 'New in DayEnglish'}
        </p>
        <h2 id={titleId}>{title}</h2>
        <p>{tr(release.description, lang)}</p>
        <AnnouncementAction release={release} />
      </div>
      <button
        type="button"
        className="release-dismiss"
        aria-label={
          lang === 'ru'
            ? `Скрыть анонс: ${title}`
            : `Dismiss announcement: ${title}`
        }
        onClick={onDismiss}
      >
        <AppIcon name="close" />
      </button>
    </article>
  );
}
