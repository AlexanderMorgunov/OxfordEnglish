import today from '@/assets/brand/icons/today.svg?raw';
import grammar from '@/assets/brand/icons/grammar.svg?raw';
import review from '@/assets/brand/icons/review.svg?raw';
import vocabulary from '@/assets/brand/icons/vocabulary.svg?raw';
import library from '@/assets/brand/icons/library.svg?raw';
import progress from '@/assets/brand/icons/progress.svg?raw';
import settings from '@/assets/brand/icons/settings.svg?raw';
import more from '@/assets/brand/icons/more.svg?raw';
import sections from '@/assets/brand/icons/sections.svg?raw';
import pro from '@/assets/brand/icons/pro.svg?raw';
import feedback from '@/assets/brand/icons/feedback.svg?raw';
import support from '@/assets/brand/icons/support.svg?raw';
import about from '@/assets/brand/icons/about.svg?raw';
import close from '@/assets/brand/icons/close.svg?raw';

const ICONS = {
  today,
  grammar,
  review,
  vocabulary,
  library,
  progress,
  settings,
  more,
  sections,
  pro,
  feedback,
  support,
  about,
  close,
};
export type AppIconName = keyof typeof ICONS;

export function AppIcon({
  name,
  className = '',
}: {
  name: AppIconName;
  className?: string;
}) {
  // Only the checked-in, build-time SVG exports can reach this markup boundary.
  return (
    <span
      aria-hidden="true"
      className={`app-nav-icon ${className}`}
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}
