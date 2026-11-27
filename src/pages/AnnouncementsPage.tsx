import { useEffect, useRef } from 'react';
import { AnnouncementAction } from '@/features/announcements/AnnouncementCard';
import { useAnnouncements } from '@/features/announcements/model';
import { tr, useUiLang } from '@/features/i18n/uiLang';

export function AnnouncementsPage() {
  const lang = useUiLang((state) => state.lang);
  const releases = useAnnouncements();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);
  return (
    <section className="release-history">
      <h1 ref={heading} tabIndex={-1}>
        {lang === 'ru' ? 'Что нового' : 'What’s new'}
      </h1>
      {releases.length ? (
        <ul>
          {releases.map((release) => (
            <li key={release.id}>
              <article>
                <h2>{tr(release.title, lang)}</h2>
                <p>{tr(release.description, lang)}</p>
                <AnnouncementAction release={release} />
              </article>
            </li>
          ))}
        </ul>
      ) : (
        <p>{lang === 'ru' ? 'Пока нет обновлений.' : 'No updates yet.'}</p>
      )}
    </section>
  );
}
